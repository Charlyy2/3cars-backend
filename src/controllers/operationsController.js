const salesService = require('../services/salesService');

const createOperation = async (req, res) => {
  try {
    const { clientId, precioTotal, entregaInicial, cuotas, fechaInicio } = req.body;

    if (
      clientId === undefined ||
      precioTotal === undefined ||
      entregaInicial === undefined ||
      cuotas === undefined ||
      !fechaInicio
    ) {
      return res.status(400).json({
        error: 'Todos los campos son requeridos: clientId, precioTotal, entregaInicial, cuotas, fechaInicio',
      });
    }

    const parsedClientId = Number(clientId);
    const parsedPrecioTotal = Number(precioTotal);
    const parsedEntregaInicial = Number(entregaInicial);
    const parsedCuotas = Number(cuotas);

    if (
      Number.isNaN(parsedClientId) ||
      Number.isNaN(parsedPrecioTotal) ||
      Number.isNaN(parsedEntregaInicial) ||
      Number.isNaN(parsedCuotas)
    ) {
      return res.status(400).json({
        error: 'clientId, precioTotal, entregaInicial y cuotas deben ser numéricos',
      });
    }

    if (parsedPrecioTotal <= 0 || parsedEntregaInicial < 0 || parsedCuotas <= 0) {
      return res.status(400).json({
        error: 'precioTotal y cuotas deben ser mayores a 0, entregaInicial mayor o igual a 0',
      });
    }

    if (parsedEntregaInicial > parsedPrecioTotal) {
      return res.status(400).json({
        error: 'La entrega inicial no puede ser mayor al precio total',
      });
    }

    const result = await salesService.createSale({
      clientId: parsedClientId,
      precioTotal: parsedPrecioTotal,
      entregaInicial: parsedEntregaInicial,
      cantidadCuotas: parsedCuotas,
      fechaInicio,
    });

    return res.status(201).json(result);
  } catch (error) {
    if (error.message === 'CLIENT_NOT_FOUND') {
      return res.status(404).json({ error: 'Cliente no encontrado' });
    }

    if (error.message === 'ACTIVE_OPERATION_EXISTS') {
      return res.status(409).json({ error: 'El cliente ya tiene una operación activa' });
    }

    console.error('Error al crear operación:', error);
    return res.status(500).json({ error: 'Error al crear operación' });
  }
};

module.exports = {
  createOperation,
};
