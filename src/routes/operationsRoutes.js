const express = require('express');
const router = express.Router();
const operationsController = require('../controllers/operationsController');

// POST /operations - Crear operación completa (financiación + plan + cuotas)
router.post('/', operationsController.createOperation);

module.exports = router;
