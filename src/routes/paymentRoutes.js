const express = require('express');
const router = express.Router();
const paymentController = require('../controllers/paymentController');

// POST /payments - Procesar un nuevo pago (cuota)
router.post('/', paymentController.createPayment);

// POST /payments/saldo - Procesar un pago de saldo
router.post('/saldo', paymentController.createSaldoPayment);

// GET /payments/monthly-summary - Resumen mensual de pagos
router.get('/monthly-summary', paymentController.getMonthlySummary);

// GET /payments - Obtener todos los pagos (debe ir antes de /:clientId)
router.get('/', paymentController.getAllPayments);

// GET /payments/:clientId - Obtener pagos de un cliente
router.get('/:clientId', paymentController.getPaymentsByClientId);

module.exports = router;
