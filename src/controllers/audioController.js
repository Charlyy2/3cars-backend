const audioService = require('../services/audioService');
const clientService = require('../services/clientService');

const createAudio = async (req, res) => {
  try {
    const { clientId, url } = req.body;

    if (!clientId || !url) {
      return res.status(400).json({ error: 'clientId y url son requeridos' });
    }

    const client = await clientService.getClientById(clientId);
    if (!client) {
      return res.status(404).json({ error: 'Cliente no encontrado' });
    }

    const audio = await audioService.createAudio(clientId, url);
    res.status(201).json(audio);
  } catch (error) {
    console.error('Error al crear audio:', error);
    res.status(500).json({ error: 'Error al crear audio' });
  }
};

const getAudiosByClientId = async (req, res) => {
  try {
    const { clientId } = req.params;

    if (!clientId || isNaN(clientId)) {
      return res.status(400).json({ error: 'ID de cliente inválido' });
    }

    const audios = await audioService.getAudiosByClientId(clientId);
    res.json(audios);
  } catch (error) {
    console.error('Error al obtener audios del cliente:', error);
    res.status(500).json({ error: 'Error al obtener audios del cliente' });
  }
};

module.exports = {
  createAudio,
  getAudiosByClientId,
};
