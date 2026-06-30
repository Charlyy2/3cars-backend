const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const createVehicle = async ({ dominio, patente, modelo, anio }) => {
  return prisma.vehicle.create({
    data: {
      dominio,
      patente,
      modelo,
      anio,
      disponible: true,
    },
    include: {
      client: {
        select: {
          id: true,
          nombre: true,
        },
      },
    },
  });
};

const getVehicles = async ({ disponible } = {}) => {
  const where = {};

  if (typeof disponible === 'boolean') {
    where.disponible = disponible;
  }

  return prisma.vehicle.findMany({
    where,
    include: {
      client: {
        select: {
          id: true,
          nombre: true,
        },
      },
    },
    orderBy: {
      createdAt: 'desc',
    },
  });
};

const assignVehicle = async ({ vehicleId, clientId }) => {
  const parsedVehicleId = parseInt(vehicleId, 10);
  const parsedClientId = parseInt(clientId, 10);

  const [vehicle, client, existingClientVehicle] = await Promise.all([
    prisma.vehicle.findUnique({ where: { id: parsedVehicleId } }),
    prisma.client.findUnique({ where: { id: parsedClientId } }),
    prisma.vehicle.findUnique({ where: { clientId: parsedClientId } }),
  ]);

  if (!vehicle) {
    throw new Error('VEHICLE_NOT_FOUND');
  }

  if (!client) {
    throw new Error('CLIENT_NOT_FOUND');
  }

  if (!vehicle.disponible || vehicle.clientId) {
    throw new Error('VEHICLE_NOT_AVAILABLE');
  }

  if (existingClientVehicle) {
    throw new Error('CLIENT_ALREADY_HAS_VEHICLE');
  }

  return prisma.vehicle.update({
    where: { id: parsedVehicleId },
    data: {
      clientId: parsedClientId,
      disponible: false,
    },
    include: {
      client: {
        select: {
          id: true,
          nombre: true,
        },
      },
    },
  });
};

const unassignVehicle = async ({ vehicleId }) => {
  const parsedVehicleId = parseInt(vehicleId, 10);

  const vehicle = await prisma.vehicle.findUnique({
    where: { id: parsedVehicleId },
  });

  if (!vehicle) {
    throw new Error('VEHICLE_NOT_FOUND');
  }

  return prisma.vehicle.update({
    where: { id: parsedVehicleId },
    data: {
      clientId: null,
      disponible: true,
    },
    include: {
      client: {
        select: {
          id: true,
          nombre: true,
        },
      },
    },
  });
};

const getVehicleByClientId = async (clientId) => {
  return prisma.vehicle.findUnique({
    where: { clientId: parseInt(clientId) },
    include: {
      client: {
        select: {
          id: true,
          nombre: true,
        },
      },
    },
  });
};

module.exports = {
  createVehicle,
  getVehicles,
  assignVehicle,
  unassignVehicle,
  getVehicleByClientId,
};
