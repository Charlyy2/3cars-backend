const multer = require('multer');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');

const UPLOADS_BASE = path.join(__dirname, '../../uploads');

const ALLOWED_AUDIO_MIMES = ['audio/mpeg', 'audio/wav', 'audio/mp4', 'audio/ogg', 'audio/x-m4a'];
const ALLOWED_IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/webp'];
const ALLOWED_PAYMENT_MIMES = [...ALLOWED_IMAGE_MIMES, 'application/pdf'];

const MAX_AUDIO_SIZE = 25 * 1024 * 1024; // 25 MB
const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10 MB

const getExtension = (mimetype) => {
  const map = {
    'audio/mpeg': '.mp3',
    'audio/wav': '.wav',
    'audio/mp4': '.m4a',
    'audio/x-m4a': '.m4a',
    'audio/ogg': '.ogg',
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp',
    'application/pdf': '.pdf',
  };
  return map[mimetype] || '';
};

const makeStorage = (subdir) =>
  multer.diskStorage({
    destination: (req, file, cb) => {
      const dir = path.join(UPLOADS_BASE, subdir);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (req, file, cb) => {
      const ext = getExtension(file.mimetype);
      cb(null, `${uuidv4()}${ext}`);
    },
  });

const audioFilter = (req, file, cb) => {
  if (ALLOWED_AUDIO_MIMES.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Formato de audio no permitido. Use mp3, wav, m4a u ogg.'));
  }
};

const paymentFilter = (req, file, cb) => {
  if (ALLOWED_PAYMENT_MIMES.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Formato no permitido. Use jpg, jpeg, png, webp o pdf.'));
  }
};

const uploadAudio = multer({
  storage: makeStorage('audios'),
  fileFilter: audioFilter,
  limits: { fileSize: MAX_AUDIO_SIZE },
});

const uploadPayment = multer({
  storage: makeStorage('payments'),
  fileFilter: paymentFilter,
  limits: { fileSize: MAX_IMAGE_SIZE },
});

// Documentos de resolución del plan (boleto = imagen, contrato = pdf).
const uploadPlanDoc = multer({
  storage: makeStorage('plan-docs'),
  fileFilter: paymentFilter, // imágenes + pdf
  limits: { fileSize: MAX_IMAGE_SIZE },
});

module.exports = { uploadAudio, uploadPayment, uploadPlanDoc };
