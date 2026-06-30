const express = require('express');
const router = express.Router();
const financingController = require('../controllers/financingController');

// GET /financing/:clientId - Obtener financiación de un cliente
router.get('/:clientId', financingController.getFinancingByClientId);

// POST /financing - Crear nueva financiación
router.post('/', financingController.createFinancing);

// PUT /financing/:clientId/operation - Actualizar datos de operación
router.put('/:clientId/operation', financingController.updateOperation);

module.exports = router;
