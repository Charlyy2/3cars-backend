const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const { composicionCuota } = require('../helpers/objetivoHelper');

// Regla ÚNICA de caída por mora: un plan con UMBRAL_CAIDA o más cuotas vencidas
// impagas (PENDIENTE / PARCIAL con vencimiento anterior a ahora) cae. La usan la
// caída automática y la reactivación (que exige estar por debajo del umbral).
const UMBRAL_CAIDA = 3;

const ESTADOS_IMPAGOS = ['PENDIENTE', 'PARCIAL'];

const contarVencidasImpagas = (db, planId, ahora = new Date()) =>
  db.installment.count({
    where: {
      planId: parseInt(planId),
      fechaVencimiento: { lt: ahora },
      estado: { in: ESTADOS_IMPAGOS },
    },
  });

/**
 * Caída automática por mora. SOLO aplica a planes ACTIVOS: NEGOCIACION,
 * RESUELTO, RETIRADO (y CAIDO) conservan su estado aunque tengan cuotas
 * vencidas (p. ej. un plan RESUELTO deja sus cuotas pendientes como estaban).
 */
const updatePlanStatusForClient = async (clientId, db = prisma) => {
  const parsedClientId = parseInt(clientId);

  const plans = await db.installmentPlan.findMany({
    where: { clientId: parsedClientId, estado: 'ACTIVO' },
    select: { id: true, estado: true }
  });

  if (plans.length === 0) {
    return;
  }

  const today = new Date();

  for (const plan of plans) {
    const overdueUnpaidCount = await contarVencidasImpagas(db, plan.id, today);

    if (overdueUnpaidCount >= UMBRAL_CAIDA) {
      // updateMany con estado ACTIVO en el WHERE: si otra operación ya cambió
      // el estado (p. ej. una resolución), no se pisa.
      await db.installmentPlan.updateMany({
        where: { id: plan.id, estado: 'ACTIVO' },
        data: { estado: 'CAIDO', motivoCaida: 'MORA_AUTOMATICA' }
      });
    }
  }
};

const createInstallmentPlan = async (clientId, totalCuotas, montoCuota, fechaInicio) => {
  // Misma regla que POST /plans: un solo plan vigente por cliente (con lock).
  const { lockClient, buscarPlanVigente } = require('../helpers/lockHelper');
  const plan = await prisma.$transaction(async (tx) => {
    await lockClient(tx, clientId);
    if (await buscarPlanVigente(tx, clientId)) throw new Error('ACTIVE_PLAN_EXISTS');
    return tx.installmentPlan.create({
    data: {
      clientId,
      totalCuotas,
      montoCuotaBase: montoCuota,
      fechaInicio: new Date(fechaInicio),
      estado: 'ACTIVO',
      selladoMonto: 0,
      cuotasConSellado: 0,
      administrativoPct: 0,
      cuotaObjetivoRetiro: 0,
      retiroPct: 0
    }
    });
  });

  // Generar todas las cuotas automáticamente
  const installments = [];
  const startDate = new Date(fechaInicio);
  
  for (let i = 1; i <= totalCuotas; i++) {
    // Calcular fecha de vencimiento (mensual)
    const fechaVencimiento = new Date(startDate);
    fechaVencimiento.setMonth(fechaVencimiento.getMonth() + i);
    
    const installment = await prisma.installment.create({
      data: {
        planId: plan.id,
        numero: i,
        fechaVencimiento,
        monto: montoCuota,
        cargos: 0,
        cargosDetalle: {
          sellado: 0,
          gastoRetiro: 0,
          mora: 0
        },
        total: montoCuota,
        pagado: 0,
        estado: "PENDIENTE"
      }
    });
    
    installments.push(installment);
  }

  return {
    plan,
    installments
  };
};

const getPlansByClientId = async (clientId) => {
  await updatePlanStatusForClient(clientId);

  return await prisma.installmentPlan.findMany({
    where: {
      clientId
    },
    include: {
      installments: {
        orderBy: {
          numero: 'asc'
        }
      }
    },
    orderBy: {
      id: 'desc'
    }
  });
};

const getInstallmentsByClientId = async (clientId) => {
  await updatePlanStatusForClient(clientId);

  const installments = await prisma.installment.findMany({
    where: {
      plan: {
        clientId: parseInt(clientId)
      }
    },
    include: {
      plan: {
        include: {
          client: {
            select: {
              id: true,
              nombre: true
            }
          }
        }
      }
    },
    orderBy: {
      numero: 'asc'
    }
  });

  // Composición (cuota vs cargos, cobrado vs ajustado) calculada por el helper de dominio.
  return installments.map((i) => ({ ...i, composicion: composicionCuota(i) }));
};

module.exports = {
  UMBRAL_CAIDA,
  contarVencidasImpagas,
  createInstallmentPlan,
  getPlansByClientId,
  getInstallmentsByClientId,
  updatePlanStatusForClient
};
