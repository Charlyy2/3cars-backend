const express = require('express');
const router = express.Router();
const metricsController = require('../controllers/metricsController');

router.get('/sales/:id/metrics', metricsController.getSaleMetrics);
router.get('/dashboard/metrics', metricsController.getDashboardMetrics);

module.exports = router;
