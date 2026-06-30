const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const getCustomerBalance = async (clientId) => {
  const balance = await prisma.customerBalance.findUnique({
    where: {
      clientId: parseInt(clientId)
    }
  });

  return {
    saldoAFavor: balance ? balance.saldo : 0
  };
};

module.exports = {
  getCustomerBalance
};
