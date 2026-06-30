const express = require('express');
const router = express.Router();
const cashMovementController = require('../controllers/cashMovementController');

// GET /cash-movements/summary - ingresos, egresos, balance (con filtros de fecha)
router.get('/summary', cashMovementController.getSummary);

// GET /cash-movements/categories - catálogo de categorías
router.get('/categories', cashMovementController.getCategories);

// GET /cash-movements - lista con filtros (tipo, categoria, cliente, fechaDesde, fechaHasta)
router.get('/', cashMovementController.getMovements);

// POST /cash-movements - crear movimiento manual
router.post('/', cashMovementController.createMovement);

// PUT /cash-movements/:id - editar movimiento manual
router.put('/:id', cashMovementController.updateMovement);

// DELETE /cash-movements/:id - eliminar movimiento manual
router.delete('/:id', cashMovementController.deleteMovement);

module.exports = router;
