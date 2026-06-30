const metricsService = require('../services/metricsService');

const getSaleMetrics = async (req, res) => {
  try {
    const { id } = req.params;
    const metrics = await metricsService.calcularMetricasVenta(id);
    return res.json(metrics);
  } catch (error) {
    console.error('Error al obtener métricas de venta:', error);
    if (error.message === 'Venta no encontrada') {
      return res.status(404).json({ error: error.message });
    }
    return res.status(500).json({ error: 'Error al calcular métricas de venta' });
  }
};

const getDashboardMetrics = async (req, res) => {
  try {
    const metrics = await metricsService.calcularMetricasDashboard();
    return res.json(metrics);
  } catch (error) {
    console.error('Error al obtener métricas del dashboard:', error);
    return res.status(500).json({ error: 'Error al calcular métricas del dashboard' });
  }
};

module.exports = {
  getSaleMetrics,
  getDashboardMetrics
};
