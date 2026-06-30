const express = require('express');
const router = express.Router();
const customerBalanceController = require('../controllers/customerBalanceController');

// GET /clients/balance/:clientId - Obtener saldo a favor de un cliente
router.get('/balance/:clientId', customerBalanceController.getCustomerBalance);

module.exports = router;
