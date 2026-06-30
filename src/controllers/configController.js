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
      comisionPorcentaje,
      gastoAdminFijo,
      selladoFijo,
      gastoRetiroPorcentaje,
      commissionRules,
      includeSealInCommission
    } = req.body;

    if (tasaAnualDefault === undefined || moraDiariaDefault === undefined) {
      return res.status(400).json({
        error: 'tasaAnualDefault y moraDiariaDefault son requeridos',
      });
    }

    const parsedTasa = Number(tasaAnualDefault);
    const parsedMora = Number(moraDiariaDefault);
    const parsedComision = Number(comisionPorcentaje) || 10;
    const parsedGastoAdmin = Number(gastoAdminFijo) || 5;
    const parsedSellado = Number(selladoFijo) || 3;
    const parsedGastoRetiro = Number(gastoRetiroPorcentaje) || 5;

    if (Number.isNaN(parsedTasa) || Number.isNaN(parsedMora)) {
      return res.status(400).json({
        error: 'tasaAnualDefault y moraDiariaDefault deben ser numéricos',
      });
    }

    if (parsedTasa < 0 || parsedMora < 0) {
      return res.status(400).json({
        error: 'tasaAnualDefault y moraDiariaDefault deben ser mayores o iguales a 0',
      });
    }

    const updateData = {
      tasaAnualDefault: parsedTasa,
      moraDiariaDefault: parsedMora,
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
