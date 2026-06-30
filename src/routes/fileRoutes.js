const express = require('express');
const router = express.Router();
const { uploadAudio, uploadPayment, uploadPlanDoc } = require('../middleware/uploadMiddleware');
const fileController = require('../controllers/fileController');

// --- Documentos de resolución del plan (boleto/contrato) ---
// POST /files/plan-doc  (multipart: file) -> { path }
router.post('/plan-doc', uploadPlanDoc.single('file'), fileController.uploadPlanDoc);
// GET /files/plan-doc/:filename  (stream)
router.get('/plan-doc/:filename', fileController.streamPlanDoc);

// --- Audios ---
// POST /files/audio  (multipart: file + clientId)
router.post('/audio', uploadAudio.single('file'), fileController.uploadAudio);

// GET /files/audio/client/:clientId
router.get('/audio/client/:clientId', fileController.getAudiosByClient);

// GET /files/audio/:id  (stream)
router.get('/audio/:id', fileController.streamAudio);

// DELETE /files/audio/:id
router.delete('/audio/:id', fileController.deleteAudio);

// --- Payment Attachments ---
// POST /files/payment  (multipart: file + paymentId)
router.post('/payment', uploadPayment.single('file'), fileController.uploadPaymentAttachment);

// GET /files/payment/payment/:paymentId
router.get('/payment/payment/:paymentId', fileController.getAttachmentsByPayment);

// GET /files/payment/:id  (stream)
router.get('/payment/:id', fileController.streamAttachment);

// DELETE /files/payment/:id
router.delete('/payment/:id', fileController.deleteAttachment);

// Multer error handler
router.use((err, req, res, next) => {
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: 'El archivo supera el tamaño máximo permitido' });
  }
  if (err.message) {
    return res.status(400).json({ error: err.message });
  }
  next(err);
});

module.exports = router;
