const express = require('express');
const router = express.Router();
const installmentController = require('../controllers/installmentController');

// POST /plans - Crear un nuevo plan de cuotas
router.post('/plans', installmentController.createInstallmentPlan);

// GET /plans/:clientId - Obtener planes de un cliente
router.get('/plans/:clientId', installmentController.getPlansByClientId);

// GET /installments/:clientId - Obtener todas las cuotas de un cliente
router.get('/installments/:clientId', installmentController.getInstallmentsByClientId);

module.exports = router;
