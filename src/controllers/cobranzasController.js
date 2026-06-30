const cobranzasService = require('../services/cobranzasService');

const getCobranzasList = async (req, res) => {
  try {
    // Extract filters from query params
    const filters = {
      nombre: req.query.nombre,
      dni: req.query.dni,
      cuota: req.query.cuota,
      estado: req.query.estado
    };
    
    // Extract pagination params
    const pagination = {
      page: parseInt(req.query.page) || 1,
      length: parseInt(req.query.length) || 50
    };
    
    const result = await cobranzasService.getCobranzasList(filters, pagination);
    res.json(result);
  } catch (error) {
    console.error('Error al obtener lista de cobranzas:', error);
    res.status(500).json({ error: error.message });
  }
};

const getMetricasDelDia = async (req, res) => {
  try {
    const metricas = await cobranzasService.getMetricasDelDia();
    res.json(metricas);
  } catch (error) {
    console.error('Error al obtener métricas del día:', error);
    res.status(500).json({ error: error.message });
  }
};

const getMetricasDelMes = async (req, res) => {
  try {
    const metricas = await cobranzasService.getMetricasDelMes();
    res.json(metricas);
  } catch (error) {
    console.error('Error al obtener métricas del mes:', error);
    res.status(500).json({ error: error.message });
  }
};

module.exports = {
  getCobranzasList,
  getMetricasDelDia,
  getMetricasDelMes
};
