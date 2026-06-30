const customerBalanceService = require('../services/customerBalanceService');

const getCustomerBalance = async (req, res) => {
  try {
    const { clientId } = req.params;
    
    if (!clientId || isNaN(clientId)) {
      return res.status(400).json({ error: 'ID de cliente inválido' });
    }
    
    const balance = await customerBalanceService.getCustomerBalance(parseInt(clientId));
    res.json(balance);
  } catch (error) {
    console.error('Error al obtener saldo del cliente:', error);
    res.status(500).json({ error: 'Error al obtener saldo del cliente' });
  }
};

module.exports = {
  getCustomerBalance
};
