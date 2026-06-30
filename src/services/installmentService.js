const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const updatePlanStatusForClient = async (clientId, db = prisma) => {
  const parsedClientId = parseInt(clientId);

  const plans = await db.installmentPlan.findMany({
    where: { clientId: parsedClientId },
    select: { id: true, estado: true }
  });

  if (plans.length === 0) {
    return;
  }

  const today = new Date();

  for (const plan of plans) {
    if (plan.estado === 'CAIDO') {
      continue;
    }

    const overdueUnpaidCount = await db.installment.count({
      where: {
        planId: plan.id,
        fechaVencimiento: {
          lt: today
        },
        estado: {
          in: ['PENDIENTE', 'PARCIAL']
        }
      }
    });

    if (overdueUnpaidCount >= 3) {
      await db.installmentPlan.update({
        where: { id: plan.id },
        data: { estado: 'CAIDO' }
      });
    }
  }
};

const createInstallmentPlan = async (clientId, totalCuotas, montoCuota, fechaInicio) => {
  // Crear el plan de cuotas
  const plan = await prisma.installmentPlan.create({
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

  return await prisma.installment.findMany({
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
};

module.exports = {
  createInstallmentPlan,
  getPlansByClientId,
  getInstallmentsByClientId,
  updatePlanStatusForClient
};
