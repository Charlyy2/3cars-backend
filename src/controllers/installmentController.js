const installmentService = require('../services/installmentService');

const createInstallmentPlan = async (req, res) => {
  try {
    const { clientId, totalCuotas, montoCuota, fechaInicio } = req.body;
    
    if (!clientId || !totalCuotas || !montoCuota || !fechaInicio) {
      return res.status(400).json({ 
        error: 'Todos los campos son requeridos: clientId, totalCuotas, montoCuota, fechaInicio' 
      });
    }
    
    if (totalCuotas <= 0 || montoCuota <= 0) {
      return res.status(400).json({ 
        error: 'totalCuotas y montoCuota deben ser mayores a 0' 
      });
    }
    
    const result = await installmentService.createInstallmentPlan(
      clientId, 
      totalCuotas, 
      montoCuota, 
      fechaInicio
    );
    
    res.status(201).json(result);
  } catch (error) {
    console.error('Error al crear plan de cuotas:', error);
    res.status(500).json({ error: 'Error al crear plan de cuotas' });
  }
};

const getPlansByClientId = async (req, res) => {
  try {
    const { clientId } = req.params;
    
    if (!clientId || isNaN(clientId)) {
      return res.status(400).json({ error: 'ID de cliente inválido' });
    }
    
    const plans = await installmentService.getPlansByClientId(parseInt(clientId));
    res.json(plans);
  } catch (error) {
    console.error('Error al obtener planes del cliente:', error);
    res.status(500).json({ error: 'Error al obtener planes del cliente' });
  }
};

const getInstallmentsByClientId = async (req, res) => {
  try {
    const { clientId } = req.params;
    
    if (!clientId || isNaN(clientId)) {
      return res.status(400).json({ error: 'ID de cliente inválido' });
    }
    
    const installments = await installmentService.getInstallmentsByClientId(parseInt(clientId));
    res.json(installments);
  } catch (error) {
    console.error('Error al obtener cuotas del cliente:', error);
    res.status(500).json({ error: 'Error al obtener cuotas del cliente' });
  }
};

module.exports = {
  createInstallmentPlan,
  getPlansByClientId,
  getInstallmentsByClientId
};
