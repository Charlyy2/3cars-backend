const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const getAllClients = async () => {
  return await prisma.client.findMany({
    orderBy: {
      createdAt: 'desc'
    }
  });
};

const getClientById = async (id) => {
  return await prisma.client.findUnique({
    where: {
      id: parseInt(id)
    }
  });
};

const createClient = async (clientData) => {
  const data = {
    nombre: clientData.nombre
  };

  // Campos opcionales
  if (clientData.apellido) data.apellido = clientData.apellido;
  if (clientData.dni) data.dni = clientData.dni;
  if (clientData.fechaNacimiento) data.fechaNacimiento = new Date(clientData.fechaNacimiento);
  if (clientData.sexo) data.sexo = clientData.sexo;
  if (clientData.domicilio) data.domicilio = clientData.domicilio;
  if (clientData.localidad) data.localidad = clientData.localidad;
  if (clientData.provincia) data.provincia = clientData.provincia;
  if (clientData.codigoPostal) data.codigoPostal = clientData.codigoPostal;
  if (clientData.ingresosMensuales !== undefined) data.ingresosMensuales = Number(clientData.ingresosMensuales);
  if (clientData.email) data.email = clientData.email;
  if (clientData.telefonoFijo) data.telefonoFijo = clientData.telefonoFijo;
  if (clientData.telefonoCelular) data.telefonoCelular = clientData.telefonoCelular;
  if (clientData.observaciones) data.observaciones = clientData.observaciones;
  if (clientData.fechaSuscripcion) data.fechaSuscripcion = new Date(clientData.fechaSuscripcion);
  if (clientData.tipoContrato) data.tipoContrato = clientData.tipoContrato;

  return await prisma.client.create({
    data
  });
};

const updateClient = async (id, clientData) => {
  return await prisma.client.update({
    where: {
      id: parseInt(id)
    },
    data: clientData
  });
};

const deleteClient = async (id) => {
  const clientId = parseInt(id);

  // Borrado en cascada manual, en orden hijos -> padres, todo atómico.
  // Cubre todas las tablas que referencian al cliente o a sus planes/pagos/cuotas.
  return prisma.$transaction(async (tx) => {
    // 1) Allocations: referencian payment, installment y saldoCuota del cliente.
    await tx.paymentAllocation.deleteMany({
      where: { payment: { clientId } },
    });

    // 2) Movimientos de caja: referencian client, payment o installment.
    //    Se borran por cliente y también los ligados a sus pagos/cuotas.
    await tx.cashMovement.deleteMany({
      where: {
        OR: [
          { clientId },
          { payment: { clientId } },
          { installment: { plan: { clientId } } },
        ],
      },
    });

    // 3) Pagos del cliente.
    await tx.payment.deleteMany({ where: { clientId } });

    // 4) Cuotas de saldo (etapa SALDO) de los planes del cliente.
    await tx.saldoCuota.deleteMany({ where: { plan: { clientId } } });

    // 5) Cuotas del plan.
    await tx.installment.deleteMany({ where: { plan: { clientId } } });

    // 6) Financiación (referencia al plan) antes que el plan.
    await tx.financing.deleteMany({ where: { clientId } });

    // 7) Planes del cliente.
    await tx.installmentPlan.deleteMany({ where: { clientId } });

    // 8) Saldo a favor y audios.
    await tx.customerBalance.deleteMany({ where: { clientId } });
    await tx.audio.deleteMany({ where: { clientId } });

    // 9) Liberar el vehículo asignado (no se borra el vehículo, vuelve al stock).
    await tx.vehicle.updateMany({
      where: { clientId },
      data: { clientId: null, disponible: true },
    });

    // 10) Finalmente, el cliente.
    return tx.client.delete({ where: { id: clientId } });
  });
};

module.exports = {
  getAllClients,
  getClientById,
  createClient,
  updateClient,
  deleteClient
};
