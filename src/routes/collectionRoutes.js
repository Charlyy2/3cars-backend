const express = require('express');
const router = express.Router();
const collectionController = require('../controllers/collectionController');

// GET /cobranzas - Obtener reporte de cobranzas mensual
router.get('/', collectionController.getCollectionReport);

module.exports = router;
