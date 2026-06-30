const express = require('express');
const router = express.Router();
const cobranzasController = require('../controllers/cobranzasController');

router.get('/lista', cobranzasController.getCobranzasList);
router.get('/metricas/dia', cobranzasController.getMetricasDelDia);
router.get('/metricas/mes', cobranzasController.getMetricasDelMes);

module.exports = router;
