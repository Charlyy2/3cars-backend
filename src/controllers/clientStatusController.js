const clientStatusService = require('../services/clientStatusService');

const getClientStatus = async (req, res) => {
  try {
    const { id } = req.params;
    
    if (!id || isNaN(id)) {
      return res.status(400).json({ error: 'ID de cliente inválido' });
    }
    
    const status = await clientStatusService.getClientStatus(parseInt(id));
    res.json(status);
  } catch (error) {
    console.error('Error al obtener estado del cliente:', error);
    res.status(500).json({ error: 'Error al obtener estado del cliente' });
  }
};

module.exports = {
  getClientStatus
};
