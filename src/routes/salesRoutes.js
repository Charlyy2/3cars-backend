const express = require('express');
const router = express.Router();
const salesController = require('../controllers/salesController');

// POST /sales - Crear una operación completa (financiación + plan + cuotas)
router.post('/', salesController.createSale);

// GET /sales?clientId=X - Obtener venta de un cliente
router.get('/', salesController.getSaleByClientId);

module.exports = router;
