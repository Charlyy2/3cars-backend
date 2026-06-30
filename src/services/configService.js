const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const DEFAULT_CONFIG = {
  tasaAnualDefault: 0,
  moraDiariaDefault: 0,
  comisionPorcentaje: 10,
  gastoAdminFijo: 5,
  selladoFijo: 3,
  gastoRetiroPorcentaje: 5,
  commissionRules: [],
  includeSealInCommission: false,
};

const getConfig = async () => {
  let config = await prisma.config.findFirst({
    orderBy: { id: 'asc' },
  });

  if (!config) {
    config = await prisma.config.create({
      data: DEFAULT_CONFIG,
    });
  }

  return config;
};

const updateConfig = async ({ 
  tasaAnualDefault, 
  moraDiariaDefault,
  comisionPorcentaje,
  gastoAdminFijo,
  selladoFijo,
  gastoRetiroPorcentaje,
  commissionRules,
  includeSealInCommission
}) => {
  const config = await getConfig();

  const updateData = {
    tasaAnualDefault,
    moraDiariaDefault,
    comisionPorcentaje,
    gastoAdminFijo,
    selladoFijo,
    gastoRetiroPorcentaje,
  };

  // Solo actualizar commissionRules si se proporciona
  if (commissionRules !== undefined) {
    updateData.commissionRules = commissionRules;
  }

  if (includeSealInCommission !== undefined) {
    updateData.includeSealInCommission = !!includeSealInCommission;
  }

  return prisma.config.update({
    where: { id: config.id },
    data: updateData,
  });
};

module.exports = {
  getConfig,
  updateConfig,
};
