const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const configService = require('./configService');

const roundCurrency = (value) => Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;

/**
 * Normaliza fecha a medianoche UTC para evitar problemas de timezone
 */
const normalizeDate = (date) => {
  const d = new Date(date);
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
};

/**
 * Calcula días de atraso entre dos fechas normalizadas
 */
const calcularDiasAtraso = (fechaVencimiento, fechaActual = new Date()) => {
  const vencimiento = normalizeDate(fechaVencimiento);
  const actual = normalizeDate(fechaActual);
  return Math.floor((actual - vencimiento) / (1000 * 60 * 60 * 24));
};

/**
 * Obtiene lista de clientes para cobranzas con estado y prioridad
 * Supports filtering by name, dni, cuota, and pagination
 */
const getCobranzasList = async (filters = {}, pagination = { page: 1, length: 50 }) => {
  const config = await configService.getConfig();
  const hoy = new Date();
  const { page = 1, length = 50 } = pagination;
  const { nombre, dni, cuota, estado: estadoFiltro } = filters;
  
  // Obtener todos los clientes con planes activos
  const clients = await prisma.client.findMany({
    where: {
      ...(nombre ? {
        nombre: {
          contains: nombre,
          mode: 'insensitive'
        }
      } : {}),
      ...(dni ? {
        dni: {
          contains: dni,
          mode: 'insensitive'
        }
      } : {})
    },
    include: {
      plans: {
        where: {
          estado: 'ACTIVO'
        },
        include: {
          installments: {
            orderBy: { numero: 'asc' }
          }
        }
      }
    }
  });

  let cobranzasList = [];

  for (const client of clients) {
    if (client.plans.length === 0) continue;

    const plan = client.plans[0];
    
    // Buscar primera cuota no pagada
    let primeraCuotaNoPagada = plan.installments.find(c => c.estado !== 'PAGADO');
    
    // Si hay filtro de cuota, buscar esa cuota específica
    if (cuota) {
      const cuotaNum = parseInt(cuota);
      if (!isNaN(cuotaNum)) {
        primeraCuotaNoPagada = plan.installments.find(c => c.numero === cuotaNum && c.estado !== 'PAGADO');
      }
    }
    
    if (!primeraCuotaNoPagada) continue;

    // Excluir cuotas que vencen en meses futuros (solo mes actual o anteriores)
    const fechaVenc = new Date(primeraCuotaNoPagada.fechaVencimiento);
    const finMesActual = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0, 23, 59, 59);
    if (fechaVenc > finMesActual) continue;

    // Calcular días de atraso con fechas normalizadas
    const diasAtraso = calcularDiasAtraso(primeraCuotaNoPagada.fechaVencimiento, hoy);
    
    // IMPORTANTE: usar restante actual (total - pagado) para mora en pagos parciales
    const restante = roundCurrency(primeraCuotaNoPagada.total - primeraCuotaNoPagada.pagado);
    
    // Calcular mora si está vencida (sobre restante actual, no monto original)
    let mora = 0;
    if (diasAtraso > 0 && restante > 0) {
      mora = roundCurrency(restante * (config.moraDiariaDefault / 100) * diasAtraso);
    }

    // Determinar estado
    let estado = 'AL_DIA';
    let prioridad = 3;
    
    if (diasAtraso > 0) {
      estado = 'VENCIDO';
      prioridad = 1;
    } else if (diasAtraso > -7) {
      estado = 'PROXIMO_A_VENCER';
      prioridad = 2;
    }

    // Filtrar por estado si se especifica
    if (estadoFiltro && estadoFiltro !== 'TODOS' && estado !== estadoFiltro) {
      continue;
    }

    cobranzasList.push({
      clientId: client.id,
      clientName: client.nombre,
      clientDni: client.dni,
      cuotaActual: primeraCuotaNoPagada.numero,
      montoCuota: primeraCuotaNoPagada.total,
      montoPagado: primeraCuotaNoPagada.pagado,
      montoRestante: restante,
      mora,
      totalAPagar: roundCurrency(restante + mora),
      fechaVencimiento: primeraCuotaNoPagada.fechaVencimiento,
      diasAtraso,
      estado,
      prioridad,
      installmentId: primeraCuotaNoPagada.id
    });
  }

  // Ordenar por prioridad (vencidos primero)
  cobranzasList.sort((a, b) => {
    if (a.prioridad !== b.prioridad) {
      return a.prioridad - b.prioridad;
    }
    return b.diasAtraso - a.diasAtraso;
  });

  // Calcular paginación
  const total = cobranzasList.length;
  const totalPages = Math.ceil(total / length);
  const startIndex = (page - 1) * length;
  const endIndex = startIndex + length;
  const paginatedData = cobranzasList.slice(startIndex, endIndex);

  return {
    count: total,
    page,
    pages: totalPages,
    data: paginatedData
  };
};

/**
 * Obtiene métricas del día
 */
const getMetricasDelDia = async () => {
  const hoy = new Date();
  const inicioDia = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate(), 0, 0, 0);
  const finDia = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate(), 23, 59, 59);

  const pagosDia = await prisma.payment.findMany({
    where: {
      fecha: {
        gte: inicioDia,
        lte: finDia
      }
    }
  });

  const totalCobrado = roundCurrency(pagosDia.reduce((sum, p) => sum + (p.montoTotal || 0), 0));
  const adminGenerado = roundCurrency(pagosDia.reduce((sum, p) => sum + (p.montoAdmin || 0), 0));
  const neto = roundCurrency(totalCobrado - adminGenerado);

  return {
    totalCobrado,
    adminGenerado,
    neto,
    cantidadPagos: pagosDia.length
  };
};

/**
 * Obtiene métricas del mes
 */
const getMetricasDelMes = async () => {
  const hoy = new Date();
  const inicioMes = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
  const finMes = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0, 23, 59, 59);

  const pagosMes = await prisma.payment.findMany({
    where: {
      fecha: {
        gte: inicioMes,
        lte: finMes
      }
    }
  });

  const totalCobrado = roundCurrency(pagosMes.reduce((sum, p) => sum + (p.montoTotal || 0), 0));
  
  // Obtener comisiones del mes (solo de cuotas pagadas en el mes)
  // Usar PaymentAllocation para determinar cuotas pagadas en el período
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
      payment: true,
      installment: {
        include: {
          plan: true
        }
      }
    }
  });

  // Obtener cuotas únicas pagadas en el mes
  const cuotasPagadasMesMap = new Map();
  for (const allocation of allocationsMes) {
    const cuota = allocation.installment;
    // Las allocations de SALDO no tienen installment: se ignoran en cobranzas.
    if (cuota && cuota.estado === 'PAGADO') {
      cuotasPagadasMesMap.set(cuota.id, cuota);
    }
  }
  const cuotasPagadasMes = Array.from(cuotasPagadasMesMap.values());

  const config = await configService.getConfig();
  const commissionHelper = require('../helpers/commissionHelper');
  
  let comisionGenerada = 0;
  for (const cuota of cuotasPagadasMes) {
    const comision = commissionHelper.calculateCommissionAmount(cuota.numero, cuota.monto, config);
    comisionGenerada += roundCurrency(comision);
  }
  comisionGenerada = roundCurrency(comisionGenerada);

  // Calcular mora acumulada del mes (con fechas normalizadas)
  const cuotasConMora = await prisma.installment.findMany({
    where: {
      estado: {
        in: ['PENDIENTE', 'PARCIAL']
      },
      fechaVencimiento: {
        lt: hoy
      }
    }
  });

  let moraAcumulada = 0;
  for (const cuota of cuotasConMora) {
    // Usar fechas normalizadas para evitar problemas de timezone
    const diasAtraso = calcularDiasAtraso(cuota.fechaVencimiento, hoy);
    if (diasAtraso > 0) {
      // IMPORTANTE: usar restante actual (total - pagado) para pagos parciales
      const restante = roundCurrency(cuota.total - cuota.pagado);
      const mora = roundCurrency(restante * (config.moraDiariaDefault / 100) * diasAtraso);
      moraAcumulada += mora;
    }
  }
  moraAcumulada = roundCurrency(moraAcumulada);

  return {
    totalCobrado,
    comisionGenerada,
    moraAcumulada,
    cantidadPagos: pagosMes.length
  };
};

module.exports = {
  getCobranzasList,
  getMetricasDelDia,
  getMetricasDelMes
};
