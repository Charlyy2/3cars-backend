const clientService = require('../services/clientService');

const getAllClients = async (req, res) => {
  try {
    const clients = await clientService.getAllClients();
    res.json(clients);
  } catch (error) {
    console.error('Error al obtener clientes:', error);
    res.status(500).json({ error: 'Error al obtener clientes' });
  }
};

const getClientById = async (req, res) => {
  try {
    const { id } = req.params;
    const client = await clientService.getClientById(id);
    
    if (!client) {
      return res.status(404).json({ error: 'Cliente no encontrado' });
    }
    
    res.json(client);
  } catch (error) {
    console.error('Error al obtener cliente:', error);
    res.status(500).json({ error: 'Error al obtener cliente' });
  }
};

const createClient = async (req, res) => {
  try {
    const clientData = req.body;

    if (!clientData.nombre) {
      return res.status(400).json({ error: 'El nombre es requerido' });
    }

    if (clientData.tipoContrato && !['PLAN', 'FINANCIACION'].includes(clientData.tipoContrato)) {
      return res.status(400).json({ error: 'tipoContrato inválido. Use PLAN o FINANCIACION' });
    }

    const newClient = await clientService.createClient(clientData);
    res.status(201).json(newClient);
  } catch (error) {
    console.error('Error al crear cliente:', error);
    res.status(500).json({ error: 'Error al crear cliente' });
  }
};

const updateClient = async (req, res) => {
  try {
    const { id } = req.params;
    const clientData = req.body;
    
    const updatedClient = await clientService.updateClient(id, clientData);
    
    if (!updatedClient) {
      return res.status(404).json({ error: 'Cliente no encontrado' });
    }
    
    res.json(updatedClient);
  } catch (error) {
    console.error('Error al actualizar cliente:', error);
    res.status(500).json({ error: 'Error al actualizar cliente' });
  }
};

const deleteClient = async (req, res) => {
  try {
    const { id } = req.params;
    
    const deleted = await clientService.deleteClient(id);
    
    if (!deleted) {
      return res.status(404).json({ error: 'Cliente no encontrado' });
    }
    
    res.status(204).send();
  } catch (error) {
    console.error('Error al eliminar cliente:', error);
    res.status(500).json({ error: 'Error al eliminar cliente' });
  }
};

module.exports = {
  getAllClients,
  getClientById,
  createClient,
  updateClient,
  deleteClient
};
