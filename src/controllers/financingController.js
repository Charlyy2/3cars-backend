const financingService = require('../services/financingService');

const getFinancingByClientId = async (req, res) => {
  try {
    const { clientId } = req.params;
    
    if (!clientId || isNaN(clientId)) {
      return res.status(400).json({ error: 'ID de cliente inválido' });
    }
    
    const financing = await financingService.getFinancingByClientId(parseInt(clientId));
    
    if (!financing) {
      return res.status(404).json({ error: 'Financiación no encontrada para este cliente' });
    }
    
    res.json(financing);
  } catch (error) {
    console.error('Error al obtener financiación:', error);
    res.status(500).json({ error: 'Error al obtener financiación' });
  }
};

const createFinancing = async (req, res) => {
  try {
    const { clientId, saldo, tasaAnual, precioTotal, entregaInicial } = req.body;
    
    if (clientId === undefined || saldo === undefined) {
      return res.status(400).json({ 
        error: 'Todos los campos son requeridos: clientId, saldo' 
      });
    }
    
    if (saldo <= 0) {
      return res.status(400).json({ 
        error: 'El saldo debe ser mayor a 0' 
      });
    }

    if (tasaAnual !== undefined && Number(tasaAnual) < 0) {
      return res.status(400).json({
        error: 'La tasa anual debe ser mayor o igual a 0'
      });
    }

    // Validar campos de operación si se proporcionan
    let saldoFinanciado = null;
    if (precioTotal !== undefined || entregaInicial !== undefined) {
      if (precioTotal === undefined || entregaInicial === undefined) {
        return res.status(400).json({ 
          error: 'Si se proporciona precioTotal o entregaInicial, ambos son requeridos' 
        });
      }
      
      if (precioTotal <= 0 || entregaInicial < 0) {
        return res.status(400).json({ 
          error: 'El precioTotal debe ser mayor a 0 y entregaInicial debe ser mayor o igual a 0' 
        });
      }
      
      if (entregaInicial > precioTotal) {
        return res.status(400).json({ 
          error: 'La entrega inicial no puede ser mayor al precio total' 
        });
      }
      
      saldoFinanciado = precioTotal - entregaInicial;
    }
    
    const financing = await financingService.createFinancing(clientId, saldo, tasaAnual, precioTotal, entregaInicial, saldoFinanciado);
    res.status(201).json(financing);
  } catch (error) {
    console.error('Error al crear financiación:', error);
    res.status(500).json({ error: 'Error al crear financiación' });
  }
};

// Nuevo método para actualizar operación
const updateOperation = async (req, res) => {
  try {
    const { clientId } = req.params;
    const { precioTotal, entregaInicial } = req.body;
    
    if (!clientId || isNaN(clientId)) {
      return res.status(400).json({ error: 'ID de cliente inválido' });
    }
    
    if (precioTotal === undefined || entregaInicial === undefined) {
      return res.status(400).json({ 
        error: 'precioTotal y entregaInicial son requeridos' 
      });
    }
    
    if (precioTotal <= 0 || entregaInicial < 0) {
      return res.status(400).json({ 
        error: 'El precioTotal debe ser mayor a 0 y entregaInicial debe ser mayor o igual a 0' 
      });
    }
    
    if (entregaInicial > precioTotal) {
      return res.status(400).json({ 
        error: 'La entrega inicial no puede ser mayor al precio total' 
      });
    }
    
    const saldoFinanciado = precioTotal - entregaInicial;
    
    const financing = await financingService.updateOperation(parseInt(clientId), precioTotal, entregaInicial, saldoFinanciado);
    
    if (!financing) {
      return res.status(404).json({ error: 'Financiación no encontrada para este cliente' });
    }
    
    res.json(financing);
  } catch (error) {
    console.error('Error al actualizar operación:', error);
    res.status(500).json({ error: 'Error al actualizar operación' });
  }
};

module.exports = {
  getFinancingByClientId,
  createFinancing,
  updateOperation
};
