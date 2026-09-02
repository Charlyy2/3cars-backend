const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const configService = require('./configService');

const roundCurrency = (value) => Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;

const calculateExpectedAdminForInstallment = (cuota, adminPct) => {
  const sellado = Number(cuota?.cargosDetalle?.sellado || 0);
  const montoClienteEsperado = Number(cuota?.monto || 0) + sellado;

  return roundCurrency(montoClienteEsperado * (Number(adminPct || 0) / 100));
};

/**
 * Calcula comisión total y real de una cuota.
 * 
 * IMPORTANTE:
 * - commissionTotal: comisión esperada de la cuota (siempre se calcula)
 * - commissionReal: comisión reconocida solo si estado === 'PAGADO'
 * - Pagos parciales NO generan comisión hasta completar la cuota
 */
const calculateInstallmentCommissionProgress = (cuota, commissionHelper, config) => {
  const commissionTotal = roundCurrency(commissionHelper.calculateCommissionAmount(cuota.numero, cuota.monto, config));
  
  // Comisión real solo si la cuota está PAGADA
  const commissionReal = cuota.estado === 'PAGADO' ? commissionTotal : 0;

  return {
    commissionTotal,
    commissionReal
  };
};

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
  let comisionTotal = 0;
  let comisionesPagadas = 0;
  let gastosAdministrativos = 0;
  let adminEstimado = 0;
  let selladoTotal = 0;
  let moraGenerada = 0;

  // Procesar cada cuota
  const commissionHelper = require('../helpers/commissionHelper');
  
  for (const cuota of plan.installments) {
    totalEsperado += cuota.total;
    adminEstimado += calculateExpectedAdminForInstallment(cuota, plan.administrativoPct);

    const { commissionTotal, commissionReal } = calculateInstallmentCommissionProgress(cuota, commissionHelper, config);
    comisionTotal += commissionTotal;
    comisionesPagadas += commissionReal;

    // Calcular mora si está vencida y no pagada completamente
    if (cuota.estado !== 'PAGADO') {
      const fechaVencimiento = new Date(cuota.fechaVencimiento);
      const hoy = new Date();
      
      if (hoy > fechaVencimiento) {
        const diasVencidos = Math.floor((hoy - fechaVencimiento) / (1000 * 60 * 60 * 24));
        const deudaRestante = roundCurrency(cuota.total - cuota.pagado);
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
  comisionTotal = roundCurrency(comisionTotal);
  comisionesPagadas = roundCurrency(comisionesPagadas);
  adminEstimado = roundCurrency(adminEstimado);
  moraGenerada = roundCurrency(moraGenerada);

  // Calcular sellado cobrado real (solo cuotas PAGADAS)
  let selladoCobrado = 0;
  const selladoLog = [];
  for (const cuota of plan.installments) {
    const selladoCuota = Number(cuota?.cargosDetalle?.sellado || 0);
    if (selladoCuota > 0) {
      if (cuota.estado === 'PAGADO') {
        selladoCobrado += roundCurrency(selladoCuota);
        selladoLog.push({ cuota: cuota.numero, sellado: selladoCuota, reconocido: true });
      } else {
        selladoLog.push({ cuota: cuota.numero, sellado: selladoCuota, reconocido: false, estado: cuota.estado });
      }
    }
  }
  selladoCobrado = roundCurrency(selladoCobrado);
  
  console.log('💵 Sellado cobrado:', { selladoCobrado, selladoTotal, detalle: selladoLog });

  const gananciaEstimada = roundCurrency(comisionTotal + selladoTotal - adminEstimado);
  const gananciaNeta = roundCurrency(comisionesPagadas + selladoCobrado - gastosAdministrativos);
  
  console.log('📊 Métricas calculadas:', {
    saleId: plan.id,
    totalCobrado,
    totalEsperado,
    comisionTotal,
    comisionesPagadas,
    selladoTotal,
    selladoCobrado,
    adminEstimado,
    gastosAdministrativos,
    gananciaEstimada,
    gananciaNeta
  });

  const totalACobrar = roundCurrency(totalEsperado + selladoTotal);
  const totalRestante = roundCurrency(Math.max(totalACobrar - totalCobrado, 0));
  
  // Calcular cuotas pagadas para flag de retiro
  const cuotasPagadas = plan.installments.filter(c => c.estado === 'PAGADO').length;
  const puedeRetirar = cuotasPagadas >= (plan.cuotaObjetivoRetiro || 0);

  return {
    saleId: plan.id,
    clientId: plan.clientId,
    clientName: plan.client.nombre,
    totalCobrado,
    totalEsperado,
    totalACobrar,
    totalRestante,
    porcentajeCobrado: totalACobrar > 0 ? roundCurrency((totalCobrado / totalACobrar) * 100) : 0,
    comisionTotal,
    comisionesPagadas,
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
  let comisionesMes = 0;
  let gastosMes = 0;

  const clientesEstado = new Map();
  const commissionHelper = require('../helpers/commissionHelper');

  for (const cuota of cuotasActivas) {
    const deudaRestante = roundCurrency(cuota.total - cuota.pagado);
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

  const allocationsMes = await prisma.paymentAllocation.findMany({
    where: {
      payment: {
        fecha: {
          gte: inicioMes,
          lte: finMes
        }
      }
    },
    include: {
      installment: true
    }
  });
  
  gastosMes = roundCurrency(paymentsWithAdmin.reduce((sum, p) => sum + (p.montoAdmin || 0), 0));
  comisionesMes = roundCurrency(allocationsMes.reduce((sum, allocation) => {
    const installment = allocation.installment;
    // Las allocations de SALDO no tienen installment (no devengan comisión): se ignoran.
    if (!installment) return sum;
    const installmentCommission = roundCurrency(commissionHelper.calculateCommissionAmount(installment.numero, installment.monto, config));
    const installmentTotal = Number(installment.total || 0);
    const ratio = installmentTotal > 0 ? Math.min(Number(allocation.monto || 0) / installmentTotal, 1) : 0;

    return sum + roundCurrency(installmentCommission * ratio);
  }, 0));

  gastosMes = roundCurrency(gastosMes);
  moraMes = roundCurrency(moraMes);
  totalCobradoMes = roundCurrency(totalCobradoMes);
  totalEsperadoMes = roundCurrency(totalEsperadoMes);

  const gananciaMes = roundCurrency(comisionesMes - gastosMes);
  const porcentajeCobranza = totalEsperadoMes > 0 
    ? roundCurrency((totalCobradoMes / (totalCobradoMes + totalEsperadoMes)) * 100) 
    : 0;

  return {
    totalCobradoMes,
    totalEsperadoMes,
    porcentajeCobranza,
    comisionesMes,
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

/**
 * Calcula la ganancia de una cuota específica
 */
const calcularGananciaCuota = (cuota, config) => {
  let costos = 0;

  // Comisión (solo cuotas 1 y 2)
  if (cuota.numero === 1 || cuota.numero === 2) {
    costos += cuota.monto * (config.comisionPorcentaje / 100);
  }

  // Gastos administrativos y sellado (desde cuota 2)
  if (cuota.numero >= 2) {
    costos += config.gastoAdminFijo + config.selladoFijo;
  }

  const ingreso = cuota.pagado;
  const ganancia = ingreso - costos;

  return {
    ingreso,
    costos,
    ganancia,
    porcentajeGanancia: ingreso > 0 ? (ganancia / ingreso) * 100 : 0
  };
};

module.exports = {
  calcularMetricasVenta,
  calcularMetricasDashboard,
  calcularGananciaCuota
};
