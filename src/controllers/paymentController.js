const paymentService = require('../services/paymentService');

const createPayment = async (req, res) => {
  try {
    const { clientId, monto, administrativoPct, fecha } = req.body;
    
    if (!clientId || !monto) {
      return res.status(400).json({ 
        error: 'Todos los campos son requeridos: clientId, monto' 
      });
    }
    
    if (monto <= 0) {
      return res.status(400).json({ 
        error: 'El monto debe ser mayor a 0' 
      });
    }
    
    const adminPct = administrativoPct !== undefined ? Number(administrativoPct) : undefined;
    
    const result = await paymentService.createPayment(clientId, monto, adminPct, fecha);
    res.status(201).json(result);
  } catch (error) {
    console.error('Error al procesar pago:', error);
    
    if (error.message === 'Cliente no encontrado') {
      return res.status(404).json({ error: 'Cliente no encontrado' });
    }
    if (error.message === 'SIN_CUOTAS_EXIGIBLES') {
      return res.status(409).json({ error: 'El cliente no tiene cuotas exigibles. Si el plan fue resuelto, registrá el pago como saldo.' });
    }
    if (error.message && error.message.startsWith('CASH_CATEGORY_NOT_FOUND')) {
      return res.status(409).json({
        error: 'Falta una categoría de caja del sistema. Ejecutá las migraciones y el seed.',
        detail: error.message,
      });
    }

    res.status(500).json({ error: 'Error al procesar pago', detail: error.message });
  }
};

const getPaymentsByClientId = async (req, res) => {
  try {
    const { clientId } = req.params;
    
    if (!clientId || isNaN(clientId)) {
      return res.status(400).json({ error: 'ID de cliente inválido' });
    }
    
    const payments = await paymentService.getPaymentsByClientId(parseInt(clientId));
    res.json(payments);
  } catch (error) {
    console.error('Error al obtener pagos del cliente:', error);
    res.status(500).json({ error: 'Error al obtener pagos del cliente' });
  }
};

const getMonthlySummary = async (req, res) => {
  try {
    const { month } = req.query;

    if (month && !/^\d{4}-\d{2}$/.test(month)) {
      return res.status(400).json({
        error: 'Formato de month inválido. Use YYYY-MM',
      });
    }

    const summary = await paymentService.getMonthlySummary(month);
    res.json(summary);
  } catch (error) {
    console.error('Error al obtener resumen mensual de pagos:', error);
    res.status(500).json({ error: 'Error al obtener resumen mensual de pagos' });
  }
};

const getAllPayments = async (req, res) => {
  try {
    // Extract filters from query params
    const filters = {
      nombre: req.query.nombre,
      dni: req.query.dni,
      cuota: req.query.cuota,
      fechaDesde: req.query.fechaDesde,
      fechaHasta: req.query.fechaHasta
    };
    
    // Extract pagination params
    const pagination = {
      page: parseInt(req.query.page) || 1,
      length: parseInt(req.query.length) || 50
    };
    
    const result = await paymentService.getAllPayments(filters, pagination);
    res.json(result);
  } catch (error) {
    console.error('Error al obtener todos los pagos:', error);
    res.status(500).json({ error: 'Error al obtener los pagos', detail: error.message });
  }
};

/**
 * Pago de SALDO (etapa post-resolución). Imputa a cuotas de saldo.
 */
const createSaldoPayment = async (req, res) => {
  try {
    const { clientId, monto, fecha } = req.body;
    if (!clientId || !monto) {
      return res.status(400).json({ error: 'clientId y monto son requeridos' });
    }
    if (monto <= 0) {
      return res.status(400).json({ error: 'El monto debe ser mayor a 0' });
    }
    const result = await paymentService.createSaldoPayment(clientId, monto, {
      fecha,
      createdBy: req.user?.username || null,
    });
    res.status(201).json(result);
  } catch (error) {
    if (error.message === 'Cliente no encontrado') {
      return res.status(404).json({ error: 'Cliente no encontrado' });
    }
    if (error.message === 'SALDO_SIN_CUOTAS_PENDIENTES') {
      return res.status(409).json({ error: 'El cliente no tiene cuotas de saldo pendientes' });
    }
    console.error('Error al procesar pago de saldo:', error);
    res.status(500).json({ error: 'Error al procesar pago de saldo', detail: error.message });
  }
};

module.exports = {
  createPayment,
  createSaldoPayment,
  getPaymentsByClientId,
  getAllPayments,
  getMonthlySummary
};
