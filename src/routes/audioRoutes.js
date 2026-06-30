const express = require('express');
const router = express.Router();
const audioController = require('../controllers/audioController');

// POST /audios - Registrar audio (metadata URL)
router.post('/', audioController.createAudio);

// GET /audios/:clientId - Listar audios de un cliente
router.get('/:clientId', audioController.getAudiosByClientId);

module.exports = router;
