const fileService = require('../services/fileService');

const uploadAudio = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No se recibió ningún archivo' });
    }

    const { clientId } = req.body;
    if (!clientId) {
      return res.status(400).json({ error: 'clientId es requerido' });
    }

    const audio = await fileService.createAudio({
      clientId,
      filename: req.file.filename,
      originalName: req.file.originalname,
      mimeType: req.file.mimetype,
      size: req.file.size,
      uploadedBy: req.user?.username || req.user?.id?.toString() || null,
    });

    res.status(201).json(audio);
  } catch (error) {
    console.error('Error al subir audio:', error);
    res.status(500).json({ error: 'Error al procesar el audio' });
  }
};

const getAudiosByClient = async (req, res) => {
  try {
    const { clientId } = req.params;
    const audios = await fileService.getAudiosByClientId(clientId);
    res.json(audios);
  } catch (error) {
    console.error('Error al obtener audios:', error);
    res.status(500).json({ error: 'Error al obtener audios' });
  }
};

const streamAudio = async (req, res) => {
  try {
    const { id } = req.params;
    const { audio, filePath } = await fileService.getAudioFile(id);
    res.setHeader('Content-Type', audio.mimeType);
    res.setHeader('Content-Disposition', `inline; filename="${audio.originalName}"`);
    require('fs').createReadStream(filePath).pipe(res);
  } catch (error) {
    if (error.message === 'AUDIO_NOT_FOUND' || error.message === 'FILE_NOT_FOUND') {
      return res.status(404).json({ error: 'Archivo no encontrado' });
    }
    console.error('Error al servir audio:', error);
    res.status(500).json({ error: 'Error al obtener el archivo' });
  }
};

const deleteAudio = async (req, res) => {
  try {
    const { id } = req.params;
    await fileService.deleteAudio(id);
    res.json({ message: 'Audio eliminado correctamente' });
  } catch (error) {
    if (error.message === 'AUDIO_NOT_FOUND') {
      return res.status(404).json({ error: 'Audio no encontrado' });
    }
    console.error('Error al eliminar audio:', error);
    res.status(500).json({ error: 'Error al eliminar el audio' });
  }
};

const uploadPaymentAttachment = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No se recibió ningún archivo' });
    }

    const { paymentId } = req.body;
    if (!paymentId) {
      return res.status(400).json({ error: 'paymentId es requerido' });
    }

    const attachment = await fileService.createPaymentAttachment({
      paymentId,
      filename: req.file.filename,
      originalName: req.file.originalname,
      mimeType: req.file.mimetype,
      size: req.file.size,
      uploadedBy: req.user?.username || req.user?.id?.toString() || null,
    });

    res.status(201).json(attachment);
  } catch (error) {
    console.error('Error al subir adjunto:', error);
    res.status(500).json({ error: 'Error al procesar el adjunto' });
  }
};

const getAttachmentsByPayment = async (req, res) => {
  try {
    const { paymentId } = req.params;
    const attachments = await fileService.getAttachmentsByPaymentId(paymentId);
    res.json(attachments);
  } catch (error) {
    console.error('Error al obtener adjuntos:', error);
    res.status(500).json({ error: 'Error al obtener adjuntos' });
  }
};

const streamAttachment = async (req, res) => {
  try {
    const { id } = req.params;
    const { attachment, filePath } = await fileService.getAttachmentFile(id);
    res.setHeader('Content-Type', attachment.mimeType);
    res.setHeader('Content-Disposition', `inline; filename="${attachment.originalName}"`);
    require('fs').createReadStream(filePath).pipe(res);
  } catch (error) {
    if (error.message === 'ATTACHMENT_NOT_FOUND' || error.message === 'FILE_NOT_FOUND') {
      return res.status(404).json({ error: 'Archivo no encontrado' });
    }
    console.error('Error al servir adjunto:', error);
    res.status(500).json({ error: 'Error al obtener el archivo' });
  }
};

const deleteAttachment = async (req, res) => {
  try {
    const { id } = req.params;
    await fileService.deletePaymentAttachment(id);
    res.json({ message: 'Adjunto eliminado correctamente' });
  } catch (error) {
    if (error.message === 'ATTACHMENT_NOT_FOUND') {
      return res.status(404).json({ error: 'Adjunto no encontrado' });
    }
    console.error('Error al eliminar adjunto:', error);
    res.status(500).json({ error: 'Error al eliminar el adjunto' });
  }
};

// Sube un documento de resolución del plan (boleto/contrato) y devuelve su path.
// El path se guarda luego en el plan (boletoCompraventa / contratoMutuo).
const uploadPlanDoc = async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No se recibió ningún archivo' });
    // path relativo servible
    const relPath = `plan-docs/${req.file.filename}`;
    return res.status(201).json({
      path: relPath,
      originalName: req.file.originalname,
      mimeType: req.file.mimetype,
      size: req.file.size,
    });
  } catch (error) {
    console.error('Error al subir documento de plan:', error);
    return res.status(500).json({ error: 'Error al subir el documento' });
  }
};

// Sirve (stream) un documento de plan por su filename. Path interno fijo a uploads/plan-docs.
const streamPlanDoc = async (req, res) => {
  try {
    const path = require('path');
    const fs = require('fs');
    const { filename } = req.params;
    // Evitar path traversal: solo el basename.
    const safe = path.basename(filename);
    const filePath = path.join(__dirname, '../../uploads/plan-docs', safe);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Archivo no encontrado' });
    const ext = path.extname(safe).toLowerCase();
    const mimes = { '.pdf': 'application/pdf', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };
    res.setHeader('Content-Type', mimes[ext] || 'application/octet-stream');
    fs.createReadStream(filePath).pipe(res);
  } catch (error) {
    console.error('Error al servir documento de plan:', error);
    res.status(500).json({ error: 'Error al obtener el documento' });
  }
};

module.exports = {
  uploadAudio,
  getAudiosByClient,
  streamAudio,
  deleteAudio,
  uploadPaymentAttachment,
  getAttachmentsByPayment,
  streamAttachment,
  deleteAttachment,
  uploadPlanDoc,
  streamPlanDoc,
};
