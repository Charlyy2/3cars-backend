const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const DEFAULT_CONFIG = {
  tasaAnualDefault: 0,
  moraDiariaDefault: 0,
  moraDiariaPlan: 0,
  moraDiariaNegociacion: 0,
  gastoAdminFijo: 5,
  selladoFijo: 3,
  gastoRetiroPorcentaje: 5,
  // comisionPorcentaje / commissionRules / includeSealInCommission: deprecados
  // (no existe comisión en 3CARS). Quedan con los defaults del schema.
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

  // Compatibilidad: si las tasas nuevas vinieran nulas/indefinidas (config vieja
  // previa a la migración), caer al valor único anterior.
  if (config.moraDiariaPlan === undefined || config.moraDiariaPlan === null) {
    config.moraDiariaPlan = config.moraDiariaDefault || 0;
  }
  if (config.moraDiariaNegociacion === undefined || config.moraDiariaNegociacion === null) {
    config.moraDiariaNegociacion = config.moraDiariaDefault || 0;
  }

  return config;
};

const updateConfig = async ({
  tasaAnualDefault,
  moraDiariaDefault,
  moraDiariaPlan,
  moraDiariaNegociacion,
  gastoAdminFijo,
  selladoFijo,
  gastoRetiroPorcentaje,
}) => {
  const config = await getConfig();

  // Resolver las dos tasas nuevas con fallback al valor único anterior.
  const planRate = moraDiariaPlan !== undefined ? moraDiariaPlan
    : (moraDiariaDefault !== undefined ? moraDiariaDefault : config.moraDiariaPlan);
  const negRate = moraDiariaNegociacion !== undefined ? moraDiariaNegociacion
    : (moraDiariaDefault !== undefined ? moraDiariaDefault : config.moraDiariaNegociacion);

  const updateData = {
    tasaAnualDefault,
    // Mantener moraDiariaDefault como alias del plan para lectores legacy.
    moraDiariaDefault: planRate,
    moraDiariaPlan: planRate,
    moraDiariaNegociacion: negRate,
    gastoAdminFijo,
    selladoFijo,
    gastoRetiroPorcentaje,
  };

  return prisma.config.update({
    where: { id: config.id },
    data: updateData,
  });
};

module.exports = {
  getConfig,
  updateConfig,
};
