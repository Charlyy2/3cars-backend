const configService = require('../services/configService');

const getConfig = async (req, res) => {
  try {
    const config = await configService.getConfig();
    return res.json(config);
  } catch (error) {
    console.error('Error al obtener configuración:', error);
    return res.status(500).json({ error: 'Error al obtener configuración' });
  }
};

const updateConfig = async (req, res) => {
  try {
    const {
      tasaAnualDefault,
      moraDiariaDefault,
      moraDiariaPlan,
      moraDiariaNegociacion,
      comisionPorcentaje,
      gastoAdminFijo,
      selladoFijo,
      gastoRetiroPorcentaje,
      commissionRules,
      includeSealInCommission
    } = req.body;

    // Compatibilidad: si no llegan las tasas nuevas, usar la única anterior.
    const rawPlan = moraDiariaPlan !== undefined ? moraDiariaPlan : moraDiariaDefault;
    const rawNeg = moraDiariaNegociacion !== undefined ? moraDiariaNegociacion : moraDiariaDefault;

    if (tasaAnualDefault === undefined || rawPlan === undefined || rawNeg === undefined) {
      return res.status(400).json({
        error: 'tasaAnualDefault, moraDiariaPlan y moraDiariaNegociacion son requeridos',
      });
    }

    const parsedTasa = Number(tasaAnualDefault);
    const parsedMoraPlan = Number(rawPlan);
    const parsedMoraNeg = Number(rawNeg);
    const parsedComision = Number(comisionPorcentaje) || 10;
    const parsedGastoAdmin = Number(gastoAdminFijo) || 5;
    const parsedSellado = Number(selladoFijo) || 3;
    const parsedGastoRetiro = Number(gastoRetiroPorcentaje) || 5;

    if (Number.isNaN(parsedTasa) || Number.isNaN(parsedMoraPlan) || Number.isNaN(parsedMoraNeg)) {
      return res.status(400).json({
        error: 'tasaAnualDefault, moraDiariaPlan y moraDiariaNegociacion deben ser numéricos',
      });
    }

    if (parsedTasa < 0 || parsedMoraPlan < 0 || parsedMoraNeg < 0) {
      return res.status(400).json({
        error: 'tasaAnualDefault, moraDiariaPlan y moraDiariaNegociacion deben ser mayores o iguales a 0',
      });
    }

    const updateData = {
      tasaAnualDefault: parsedTasa,
      // Alias legacy = tasa de plan.
      moraDiariaDefault: parsedMoraPlan,
      moraDiariaPlan: parsedMoraPlan,
      moraDiariaNegociacion: parsedMoraNeg,
      comisionPorcentaje: parsedComision,
      gastoAdminFijo: parsedGastoAdmin,
      selladoFijo: parsedSellado,
      gastoRetiroPorcentaje: parsedGastoRetiro,
    };

    // Agregar commissionRules si se proporciona
    if (commissionRules !== undefined) {
      updateData.commissionRules = commissionRules;
    }

    if (includeSealInCommission !== undefined) {
      updateData.includeSealInCommission = !!includeSealInCommission;
    }

    const config = await configService.updateConfig(updateData);

    return res.json(config);
  } catch (error) {
    console.error('Error al actualizar configuración:', error);
    return res.status(500).json({ error: 'Error al actualizar configuración' });
  }
};

module.exports = {
  getConfig,
  updateConfig,
};
