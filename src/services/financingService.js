const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const configService = require('./configService');
const { updatePlanStatusForClient } = require('./installmentService');

const getFinancingByClientId = async (clientId) => {
  const config = await configService.getConfig();
  await updatePlanStatusForClient(clientId);

  // Obtener financiación del cliente
  const financing = await prisma.financing.findFirst({
    where: {
      clientId: parseInt(clientId)
    },
    include: {
      client: {
        select: {
          id: true,
          nombre: true
        }
      }
    }
  });

  if (!financing) {
    return null;
  }

  // Calcular cuotas vencidas
  const overdueInstallments = await prisma.installment.findMany({
    where: {
      plan: {
        clientId: parseInt(clientId)
      },
      fechaVencimiento: {
        lt: new Date()
      },
      estado: {
        in: ['PENDIENTE', 'PARCIAL']
      }
    },
    orderBy: {
      fechaVencimiento: 'asc'
    }
  });

  // Calcular días de atraso total
  let totalOverdueDays = 0;
  const today = new Date();

  for (const installment of overdueInstallments) {
    const overdueDays = Math.floor((today - installment.fechaVencimiento) / (1000 * 60 * 60 * 24));
    totalOverdueDays += overdueDays;
  }

  // Calcular interés acumulado por mora diaria configurable.
  // La financiación es del plan → tasa de PLANES.
  const moraDiaria = config.moraDiariaPlan;
  const accumulatedInterest = financing.saldo * (moraDiaria / 100) * totalOverdueDays;

  // Calcular deuda total
  const totalDebt = financing.saldo + accumulatedInterest;

  return {
    financing: {
      id: financing.id,
      saldo: financing.saldo,
      tasaAnual: financing.tasaAnual,
      fechaInicio: financing.fechaInicio,
      precioTotal: financing.precioTotal,
      entregaInicial: financing.entregaInicial,
      saldoFinanciado: financing.saldoFinanciado,
      client: financing.client
    },
    calculation: {
      diasAtraso: totalOverdueDays,
      moraDiaria,
      tasaDiaria: moraDiaria,
      interesAcumulado: accumulatedInterest,
      deudaTotal: totalDebt
    },
    overdueInstallments: overdueInstallments.map(installment => ({
      id: installment.id,
      numero: installment.numero,
      fechaVencimiento: installment.fechaVencimiento,
      monto: installment.monto,
      pagado: installment.pagado,
      estado: installment.estado,
      diasAtraso: Math.floor((today - installment.fechaVencimiento) / (1000 * 60 * 60 * 24))
    }))
  };
};

const createFinancing = async (clientId, saldo, tasaAnual, precioTotal = null, entregaInicial = null, saldoFinanciado = null) => {
  const config = await configService.getConfig();
  const resolvedTasaAnual = tasaAnual !== undefined && tasaAnual !== null
    ? tasaAnual
    : config.tasaAnualDefault;

  return await prisma.financing.create({
    data: {
      clientId: parseInt(clientId),
      saldo,
      tasaAnual: resolvedTasaAnual,
      precioTotal,
      entregaInicial,
      saldoFinanciado
    },
    include: {
      client: {
        select: {
          id: true,
          nombre: true
        }
      }
    }
  });
};

// Nuevo método para actualizar operación
const updateOperation = async (clientId, precioTotal, entregaInicial, saldoFinanciado) => {
  // Primero buscar el registro de financiación del cliente
  const financing = await prisma.financing.findFirst({
    where: {
      clientId: parseInt(clientId)
    }
  });

  if (!financing) {
    return null;
  }

  // Luego actualizar usando el ID
  return await prisma.financing.update({
    where: {
      id: financing.id
    },
    data: {
      precioTotal,
      entregaInicial,
      saldoFinanciado
    },
    include: {
      client: {
        select: {
          id: true,
          nombre: true
        }
      }
    }
  });
};

module.exports = {
  getFinancingByClientId,
  createFinancing,
  updateOperation
};
