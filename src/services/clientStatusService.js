const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const getClientStatus = async (clientId) => {
  // Obtener todas las cuotas del cliente ordenadas por número
  const installments = await prisma.installment.findMany({
    where: {
      plan: {
        clientId: parseInt(clientId)
      }
    },
    orderBy: {
      numero: 'asc'
    }
  });

  const today = new Date();
  let overdueInstallments = 0;
  let consecutiveUnpaid = 0;
  let maxConsecutiveUnpaid = 0;
  let currentConsecutive = 0;

  for (const installment of installments) {
    const isOverdue = installment.fechaVencimiento < today;
    const isUnpaid = installment.estado !== 'PAGADO';

    if (isOverdue && isUnpaid) {
      overdueInstallments++;
      currentConsecutive++;
      maxConsecutiveUnpaid = Math.max(maxConsecutiveUnpaid, currentConsecutive);
    } else {
      currentConsecutive = 0;
    }
  }

  // Determinar estado del cliente
  let estado;
  if (maxConsecutiveUnpaid >= 3) {
    estado = 'CAIDO';
  } else if (overdueInstallments >= 1) {
    estado = 'ATRASADO';
  } else {
    estado = 'AL_DIA';
  }

  return {
    estado,
    cuotasVencidas: overdueInstallments,
    cuotasConsecutivasImpagas: maxConsecutiveUnpaid
  };
};

module.exports = {
  getClientStatus
};
