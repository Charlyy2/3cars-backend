const express = require('express');
const router = express.Router();
const clientStatusController = require('../controllers/clientStatusController');

// GET /clients/:id/status - Obtener estado de un cliente específico
router.get('/:id/status', clientStatusController.getClientStatus);

module.exports = router;
