const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const { isCuotaSaldada, deudaEfectivaCuota, composicionCuota, evaluarObjetivo } = require('../helpers/objetivoHelper');
const configService = require('./configService');

const roundCurrency = (value) => Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;

const calculateExpectedAdminForInstallment = (cuota, adminPct) => {
  const sellado = Number(cuota?.cargosDetalle?.sellado || 0);
  const montoClienteEsperado = Number(cuota?.monto || 0) + sellado;

  return roundCurrency(montoClienteEsperado * (Number(adminPct || 0) / 100));
};

/**
 * Suma montos de Caja por categoría (fuente monetaria real).
 * En 3CARS NO existe comisión: COMISION_CUOTA / COMISION_NEGOCIACION solo pueden
 * aparecer como movimientos HISTÓRICOS y siempre son EGRESOS (nunca ganancia).
 * El único margen equivalente es GASTO_RETIRO_COBRADO - GASTO_RETIRO_REAL.
 */
const sumarCajaPorCategoria = async (where) => {
  const movs = await prisma.cashMovement.findMany({
    where,
    select: { amount: true, category: { select: { name: true } } },
  });
  const out = {};
  for (const m of movs) out[m.category.name] = roundCurrency((out[m.category.name] || 0) + m.amount);
  return out;
};

const margenRetiro = (porCat) =>
  roundCurrency((porCat.GASTO_RETIRO_COBRADO || 0) - (porCat.GASTO_RETIRO_REAL || 0));

// Comisiones históricas (egresos ya registrados en Caja antes de deprecarlas).
const comisionesHistoricas = (porCat) =>
  roundCurrency((porCat.COMISION_CUOTA || 0) + (porCat.COMISION_NEGOCIACION || 0));

/**
 * Calcula métricas financieras de una venta específica
 */
const calcularMetricasVenta = async (saleId) => {
  // Obtener el plan de cuotas de la venta
  const plan = await prisma.installmentPlan.findFirst({
    where: { id: parseInt(saleId) },
    include: {
      installments: {
        orderBy: { numero: 'asc' }
      },
      client: true
    }
  });

  if (!plan) {
    throw new Error('Venta no encontrada');
  }

  const config = await configService.getConfig();
  
  // Inicializar métricas
  let totalCobrado = 0;
  let totalEsperado = 0;
  let gastosAdministrativos = 0;
  let adminEstimado = 0;
  let selladoTotal = 0;
  let moraGenerada = 0;

  // Procesar cada cuota
  for (const cuota of plan.installments) {
    totalEsperado += cuota.total;
    adminEstimado += calculateExpectedAdminForInstallment(cuota, plan.administrativoPct);

    // Calcular mora si está vencida y no saldada (pagada o regularizada)
    if (!isCuotaSaldada(cuota.estado)) {
      const fechaVencimiento = new Date(cuota.fechaVencimiento);
      const hoy = new Date();
      
      if (hoy > fechaVencimiento) {
        const diasVencidos = Math.floor((hoy - fechaVencimiento) / (1000 * 60 * 60 * 24));
        const deudaRestante = deudaEfectivaCuota(cuota);
        const moraCuota = deudaRestante * (config.moraDiariaPlan / 100) * diasVencidos;
        moraGenerada += moraCuota;
      }
    }
  }

  selladoTotal = roundCurrency((plan.selladoMonto || 0) * (plan.cuotasConSellado || 0));

  // Obtener gastos administrativos reales de los pagos
  const payments = await prisma.payment.findMany({
    where: { clientId: plan.clientId }
  });
  
  totalCobrado = roundCurrency(payments.reduce((sum, p) => sum + (p.montoTotal || p.monto || 0), 0));
  gastosAdministrativos = roundCurrency(payments.reduce((sum, p) => sum + (p.montoAdmin || 0), 0));

  totalEsperado = roundCurrency(totalEsperado);
  adminEstimado = roundCurrency(adminEstimado);
  moraGenerada = roundCurrency(moraGenerada);

  // Sellado cobrado real: el dinero que, por la cascada de imputación
  // (cuota → sellado → gasto de retiro), efectivamente cubrió el sellado.
  // Una cuota REGULARIZADA no implica sellado cobrado.
  let selladoCobrado = 0;
  let totalAjustado = 0;
  let deudaPendiente = 0;
  const selladoLog = [];
  for (const cuota of plan.installments) {
    const comp = composicionCuota(cuota);
    totalAjustado += comp.ajustado;
    deudaPendiente += deudaEfectivaCuota(cuota);
    if (comp.sellado > 0) {
      selladoCobrado += comp.selladoCobrado;
      selladoLog.push({ cuota: cuota.numero, sellado: comp.sellado, cobrado: comp.selladoCobrado, estado: cuota.estado });
    }
  }
  selladoCobrado = roundCurrency(selladoCobrado);
  totalAjustado = roundCurrency(totalAjustado);
  deudaPendiente = roundCurrency(deudaPendiente);
  
  console.log('💵 Sellado cobrado:', { selladoCobrado, selladoTotal, detalle: selladoLog });

  // Desde Caja (fuente monetaria real):
  //  - margen de retiro del cliente: GASTO_RETIRO_COBRADO - GASTO_RETIRO_REAL
  //  - comisiones históricas de las cuotas del plan: EGRESO (restan, nunca suman)
  const cajaCliente = await sumarCajaPorCategoria({ clientId: plan.clientId });
  const cajaCuotasPlan = await sumarCajaPorCategoria({ installmentId: { in: plan.installments.map((c) => c.id) } });
  const margenRetiroPlan = margenRetiro(cajaCliente);
  const comisionHistoricaEgreso = comisionesHistoricas(cajaCuotasPlan);

  // Sin comisión: la ganancia ya no suma comisiones.
  const gananciaEstimada = roundCurrency(selladoTotal - adminEstimado);
  const gananciaNeta = roundCurrency(selladoCobrado + margenRetiroPlan - gastosAdministrativos - comisionHistoricaEgreso);
  
  console.log('📊 Métricas calculadas:', {
    saleId: plan.id,
    totalCobrado,
    totalEsperado,
    margenRetiro: margenRetiroPlan,
    comisionHistoricaEgreso,
    selladoTotal,
    selladoCobrado,
    adminEstimado,
    gastosAdministrativos,
    gananciaEstimada,
    gananciaNeta
  });

  const totalACobrar = roundCurrency(totalEsperado + selladoTotal);
  // Lo ajustado/condonado no es deuda pero tampoco es dinero cobrado.
  const totalRestante = roundCurrency(Math.max(totalACobrar - totalCobrado - totalAjustado, 0));
  
  // Calcular cuotas pagadas para flag de retiro
  const cuotasPagadas = plan.installments.filter(c => c.estado === 'PAGADO').length;
  // Regla única del objetivo (pagado real + ajustes)
  const puedeRetirar = evaluarObjetivo(plan, plan.installments).objetivoCumplido;

  return {
    saleId: plan.id,
    clientId: plan.clientId,
    clientName: plan.client.nombre,
    totalCobrado,
    totalEsperado,
    totalACobrar,
    totalRestante,
    totalAjustado,      // condonado/ajustado (NO es dinero cobrado)
    deudaPendiente,     // Σ deuda efectiva de las cuotas (total - pagado - ajustado)
    porcentajeCobrado: totalACobrar > 0 ? roundCurrency((totalCobrado / totalACobrar) * 100) : 0,
    // @deprecated No existe comisión en 3CARS: siempre 0 (se mantienen las keys por compatibilidad).
    comisionTotal: 0,
    comisionesPagadas: 0,
    comisionHistoricaEgreso, // COMISION_CUOTA/NEGOCIACION históricas en Caja (egreso)
    margenRetiro: margenRetiroPlan, // GASTO_RETIRO_COBRADO - GASTO_RETIRO_REAL del cliente
    gastosAdministrativos,
    adminEstimado,
    selladoTotal,
    selladoCobrado,
    gananciaEstimada,
    moraGenerada,
    gananciaNeta,
    gananciaNetaConMora: roundCurrency(gananciaNeta + moraGenerada),
    cuotasPagadas,
    puedeRetirar
  };
};

/**
 * Calcula métricas globales del dashboard
 */
const calcularMetricasDashboard = async () => {
  const config = await configService.getConfig();
  const hoy = new Date();
  const inicioMes = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
  const finMes = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0);

  // Obtener todos los pagos del mes
  const pagosMes = await prisma.payment.findMany({
    where: {
      fecha: {
        gte: inicioMes,
        lte: finMes
      }
    }
  });

  let totalCobradoMes = roundCurrency(pagosMes.reduce((sum, pago) => sum + (pago.montoTotal || pago.monto || 0), 0));

  // Obtener todas las cuotas activas
  const cuotasActivas = await prisma.installment.findMany({
    where: {
      estado: {
        in: ['PENDIENTE', 'PARCIAL']
      }
    },
    include: {
      plan: {
        include: {
          client: true
        }
      }
    }
  });

  let totalEsperadoMes = 0;
  let moraMes = 0;
  let gastosMes = 0;

  const clientesEstado = new Map();

  for (const cuota of cuotasActivas) {
    const deudaRestante = deudaEfectivaCuota(cuota);
    totalEsperadoMes += deudaRestante;

    // Calcular mora
    const fechaVencimiento = new Date(cuota.fechaVencimiento);
    if (hoy > fechaVencimiento && cuota.estado !== 'PAGADO') {
      const diasVencidos = Math.floor((hoy - fechaVencimiento) / (1000 * 60 * 60 * 24));
      moraMes += deudaRestante * (config.moraDiariaPlan / 100) * diasVencidos;
    }

    // Contar estado de clientes
    const clientId = cuota.plan.clientId;
    if (!clientesEstado.has(clientId)) {
      const fechaVencimiento = new Date(cuota.fechaVencimiento);
      const diasVencidos = Math.floor((hoy - fechaVencimiento) / (1000 * 60 * 60 * 24));
      
      let estado = 'AL_DIA';
      if (diasVencidos > 30) {
        estado = 'CAIDO';
      } else if (diasVencidos > 0) {
        estado = 'ATRASADO';
      }
      
      clientesEstado.set(clientId, estado);
    }
  }

  // Sumar la deuda PENDIENTE del saldo (etapa post-resolución) al esperado del mes,
  // para que cuadre con lo cobrado (que ya incluye los pagos de saldo).
  const saldoCuotasActivas = await prisma.saldoCuota.findMany({
    where: { estado: { in: ['PENDIENTE', 'PARCIAL'] } },
  });
  for (const sc of saldoCuotasActivas) {
    const restanteSaldo = roundCurrency(sc.monto - sc.pagado);
    totalEsperadoMes += restanteSaldo;

    // Mora de saldo (negociación): misma fórmula diaria acumulativa, tasa propia.
    const vencSaldo = new Date(sc.fechaVencimiento);
    if (hoy > vencSaldo && restanteSaldo > 0) {
      const diasVencidos = Math.floor((hoy - vencSaldo) / (1000 * 60 * 60 * 24));
      if (diasVencidos > 0) {
        moraMes += restanteSaldo * (config.moraDiariaNegociacion / 100) * diasVencidos;
      }
    }
  }

  // Contar clientes por estado
  let clientesAlDia = 0;
  let clientesAtrasados = 0;

  clientesEstado.forEach(estado => {
    if (estado === 'AL_DIA') {
      clientesAlDia++;
    } else {
      clientesAtrasados++;
    }
  });

  // Obtener gastos administrativos reales de pagos del mes
  const paymentsWithAdmin = await prisma.payment.findMany({
    where: {
      fecha: {
        gte: inicioMes,
        lte: finMes
      }
    }
  });

  gastosMes = roundCurrency(paymentsWithAdmin.reduce((sum, p) => sum + (p.montoAdmin || 0), 0));

  // Desde Caja del mes: margen de retiro (única "ganancia" equivalente) y
  // comisiones HISTÓRICAS (egresos ya registrados; no se generan nuevas).
  const cajaMes = await sumarCajaPorCategoria({ createdAt: { gte: inicioMes, lte: new Date(finMes.getFullYear(), finMes.getMonth(), finMes.getDate(), 23, 59, 59, 999) } });
  const margenRetiroMes = margenRetiro(cajaMes);
  const comisionesMes = comisionesHistoricas(cajaMes);

  gastosMes = roundCurrency(gastosMes);
  moraMes = roundCurrency(moraMes);
  totalCobradoMes = roundCurrency(totalCobradoMes);
  totalEsperadoMes = roundCurrency(totalEsperadoMes);

  // Antes: comisionesMes - gastosMes (la comisión sumaba como ganancia: incorrecto).
  const gananciaMes = roundCurrency(margenRetiroMes - gastosMes - comisionesMes);
  const porcentajeCobranza = totalEsperadoMes > 0 
    ? roundCurrency((totalCobradoMes / (totalCobradoMes + totalEsperadoMes)) * 100) 
    : 0;

  return {
    totalCobradoMes,
    totalEsperadoMes,
    porcentajeCobranza,
    comisionesMes, // solo comisiones históricas en Caja (egreso); 0 para operaciones nuevas
    margenRetiroMes,
    gastosAdministrativosMes: gastosMes,
    moraMes,
    gananciaMes,
    gananciaNetaConMora: roundCurrency(gananciaMes + moraMes),
    proyeccionIngresos: roundCurrency(totalCobradoMes + totalEsperadoMes),
    clientesAlDia,
    clientesAtrasados,
    totalClientes: clientesAlDia + clientesAtrasados
  };
};

module.exports = {
  calcularMetricasVenta,
  calcularMetricasDashboard,
};
