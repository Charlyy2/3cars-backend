const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const path = require('path');
const fs = require('fs');

const UPLOADS_BASE = path.join(__dirname, '../../uploads');

const createAudio = async ({ clientId, filename, originalName, mimeType, size, uploadedBy }) => {
  return prisma.audio.create({
    data: {
      clientId: parseInt(clientId),
      filename,
      originalName,
      mimeType,
      size,
      uploadedBy: uploadedBy || null,
    },
  });
};

const getAudiosByClientId = async (clientId) => {
  return prisma.audio.findMany({
    where: { clientId: parseInt(clientId) },
    orderBy: { createdAt: 'desc' },
  });
};

const deleteAudio = async (id, userId) => {
  const audio = await prisma.audio.findUnique({ where: { id: parseInt(id) } });
  if (!audio) throw new Error('AUDIO_NOT_FOUND');

  const filePath = path.join(UPLOADS_BASE, 'audios', audio.filename);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

  return prisma.audio.delete({ where: { id: parseInt(id) } });
};

const createPaymentAttachment = async ({ paymentId, filename, originalName, mimeType, size, uploadedBy }) => {
  return prisma.paymentAttachment.create({
    data: {
      paymentId: parseInt(paymentId),
      filename,
      originalName,
      mimeType,
      size,
      uploadedBy: uploadedBy || null,
    },
  });
};

const getAttachmentsByPaymentId = async (paymentId) => {
  return prisma.paymentAttachment.findMany({
    where: { paymentId: parseInt(paymentId) },
    orderBy: { createdAt: 'desc' },
  });
};

const deletePaymentAttachment = async (id) => {
  const attachment = await prisma.paymentAttachment.findUnique({ where: { id: parseInt(id) } });
  if (!attachment) throw new Error('ATTACHMENT_NOT_FOUND');

  const filePath = path.join(UPLOADS_BASE, 'payments', attachment.filename);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

  return prisma.paymentAttachment.delete({ where: { id: parseInt(id) } });
};

const getAudioFile = async (id) => {
  const audio = await prisma.audio.findUnique({ where: { id: parseInt(id) } });
  if (!audio) throw new Error('AUDIO_NOT_FOUND');
  const filePath = path.join(UPLOADS_BASE, 'audios', audio.filename);
  if (!fs.existsSync(filePath)) throw new Error('FILE_NOT_FOUND');
  return { audio, filePath };
};

const getAttachmentFile = async (id) => {
  const attachment = await prisma.paymentAttachment.findUnique({ where: { id: parseInt(id) } });
  if (!attachment) throw new Error('ATTACHMENT_NOT_FOUND');
  const filePath = path.join(UPLOADS_BASE, 'payments', attachment.filename);
  if (!fs.existsSync(filePath)) throw new Error('FILE_NOT_FOUND');
  return { attachment, filePath };
};

module.exports = {
  createAudio,
  getAudiosByClientId,
  deleteAudio,
  createPaymentAttachment,
  getAttachmentsByPaymentId,
  deletePaymentAttachment,
  getAudioFile,
  getAttachmentFile,
};
