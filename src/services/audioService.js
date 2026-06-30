const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const createAudio = async (clientId, url) => {
  return prisma.audio.create({
    data: {
      clientId: parseInt(clientId),
      url,
    },
  });
};

const getAudiosByClientId = async (clientId) => {
  return prisma.audio.findMany({
    where: {
      clientId: parseInt(clientId),
    },
    orderBy: {
      createdAt: 'desc',
    },
  });
};

module.exports = {
  createAudio,
  getAudiosByClientId,
};
