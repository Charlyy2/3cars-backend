const collectionService = require('../services/collectionService');

const getCollectionReport = async (req, res) => {
  try {
    const { modo } = req.query;
    const modoFinal = modo || 'estricto';
    
    console.log("Modo usado:", modoFinal);
    
    // Validar modo
    if (!['flexible', 'estricto'].includes(modoFinal)) {
      return res.status(400).json({ 
        error: 'Modo inválido. Use "flexible" o "estricto"' 
      });
    }
    
    const report = await collectionService.getCollectionReport(modoFinal);
    res.json(report);
  } catch (error) {
    console.error('Error al obtener reporte de cobranzas:', error);
    res.status(500).json({ error: 'Error al obtener reporte de cobranzas' });
  }
};

module.exports = {
  getCollectionReport
};
