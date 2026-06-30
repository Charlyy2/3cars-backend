const cashMovementService = require('../services/cashMovementService');

// GET /cash-movements?tipo&categoria&cliente&fechaDesde&fechaHasta
const getMovements = async (req, res) => {
  try {
    const { tipo, categoria, cliente, fechaDesde, fechaHasta } = req.query;
    const movements = await cashMovementService.getMovements({
      type: tipo,
      categoryId: categoria,
      clientId: cliente,
      fechaDesde,
      fechaHasta,
    });
    return res.json(movements);
  } catch (error) {
    console.error('Error al obtener movimientos de caja:', error);
    return res.status(500).json({ error: 'Error al obtener movimientos de caja' });
  }
};

// GET /cash-movements/summary?fechaDesde&fechaHasta&tipo&cliente
const getSummary = async (req, res) => {
  try {
    const { tipo, categoria, cliente, fechaDesde, fechaHasta } = req.query;
    const summary = await cashMovementService.getSummary({
      type: tipo,
      categoryId: categoria,
      clientId: cliente,
      fechaDesde,
      fechaHasta,
    });
    return res.json(summary);
  } catch (error) {
    console.error('Error al obtener resumen de caja:', error);
    return res.status(500).json({ error: 'Error al obtener resumen de caja' });
  }
};

// GET /cash-movements/categories?tipo&soloManuales&requiereCliente
const getCategories = async (req, res) => {
  try {
    const { tipo, soloManuales, requiereCliente } = req.query;
    const filters = {};
    if (tipo) filters.type = tipo;
    if (soloManuales === 'true') filters.isManual = true;
    if (requiereCliente === 'true') filters.requiresClient = true;
    if (requiereCliente === 'false') filters.requiresClient = false;
    const categories = await cashMovementService.getCategories(filters);
    return res.json(categories);
  } catch (error) {
    console.error('Error al obtener categorías de caja:', error);
    return res.status(500).json({ error: 'Error al obtener categorías de caja' });
  }
};

// POST /cash-movements (solo manuales). El tipo lo define la categoría.
const createMovement = async (req, res) => {
  try {
    const { categoryId, amount, description, clientId } = req.body;
    if (!categoryId || amount === undefined) {
      return res.status(400).json({ error: 'categoryId y amount son requeridos' });
    }
    const movement = await cashMovementService.createManualMovement({
      categoryId,
      amount,
      description,
      clientId,
      createdBy: req.user?.username || null,
    });
    return res.status(201).json(movement);
  } catch (error) {
    if (error.message === 'INVALID_AMOUNT') {
      return res.status(400).json({ error: 'amount debe ser mayor a 0' });
    }
    if (error.message === 'CATEGORY_NOT_FOUND') {
      return res.status(404).json({ error: 'Categoría no encontrada' });
    }
    if (error.message === 'CATEGORY_NOT_MANUAL') {
      return res.status(400).json({ error: 'Esta categoría es automática y no puede crearse manualmente' });
    }
    if (error.message === 'CATEGORY_REQUIRES_CLIENT') {
      return res.status(400).json({ error: 'Esta categoría requiere asociar un cliente' });
    }
    console.error('Error al crear movimiento de caja:', error);
    return res.status(500).json({ error: 'Error al crear movimiento de caja' });
  }
};

// PUT /cash-movements/:id (solo manuales)
const updateMovement = async (req, res) => {
  try {
    const { categoryId, amount, description, clientId } = req.body;
    const movement = await cashMovementService.updateManualMovement(req.params.id, {
      categoryId,
      amount,
      description,
      clientId,
    });
    return res.json(movement);
  } catch (error) {
    if (error.message === 'MOVEMENT_NOT_FOUND') {
      return res.status(404).json({ error: 'Movimiento no encontrado' });
    }
    if (error.message === 'NOT_MANUAL') {
      return res.status(403).json({ error: 'Solo los movimientos manuales se pueden editar' });
    }
    if (error.message === 'INVALID_AMOUNT') {
      return res.status(400).json({ error: 'amount debe ser mayor a 0' });
    }
    if (error.message === 'CATEGORY_NOT_FOUND') {
      return res.status(404).json({ error: 'Categoría no encontrada' });
    }
    if (error.message === 'CATEGORY_TYPE_MISMATCH') {
      return res.status(400).json({ error: 'La categoría no corresponde al tipo del movimiento' });
    }
    console.error('Error al actualizar movimiento de caja:', error);
    return res.status(500).json({ error: 'Error al actualizar movimiento de caja' });
  }
};

// DELETE /cash-movements/:id (solo manuales)
const deleteMovement = async (req, res) => {
  try {
    await cashMovementService.deleteManualMovement(req.params.id);
    return res.json({ message: 'Movimiento eliminado correctamente' });
  } catch (error) {
    if (error.message === 'MOVEMENT_NOT_FOUND') {
      return res.status(404).json({ error: 'Movimiento no encontrado' });
    }
    if (error.message === 'NOT_MANUAL') {
      return res.status(403).json({ error: 'Solo los movimientos manuales se pueden eliminar' });
    }
    console.error('Error al eliminar movimiento de caja:', error);
    return res.status(500).json({ error: 'Error al eliminar movimiento de caja' });
  }
};

module.exports = {
  getMovements,
  getSummary,
  getCategories,
  createMovement,
  updateMovement,
  deleteMovement,
};
