const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const configService = require('./configService');

const createSale = async ({ 
  clientId, 
  precioTotal, 
  entregaInicial, 
  cantidadCuotas, 
  fechaInicio, 
  vehicleId,
  administrativoPct,
  selladoPct,
  retiroPct
}) => {
  const parsedClientId = parseInt(clientId);
  const saldo = precioTotal - entregaInicial;
  const montoCuota = Number((saldo / cantidadCuotas).toFixed(2));
  const startDate = new Date(fechaInicio);
  const config = await configService.getConfig();

  // Usar porcentajes de la venta o defaults de config
  const adminPct = administrativoPct !== undefined ? administrativoPct : 0.03125; // 0.03125% default
  const selladPct = selladoPct !== undefined ? selladoPct : 0.01875; // 0.01875% default
  const retirPct = retiroPct !== undefined ? retiroPct : (config.gastoRetiroPorcentaje || 5);

  const client = await prisma.client.findUnique({
    where: { id: parsedClientId },
  });

  if (!client) {
    throw new Error('CLIENT_NOT_FOUND');
  }

  const activeInstallments = await prisma.installment.count({
    where: {
      plan: {
        clientId: parsedClientId,
      },
      estado: {
        in: ['PENDIENTE', 'PARCIAL'],
      },
    },
  });

  if (activeInstallments > 0) {
    throw new Error('ACTIVE_OPERATION_EXISTS');
  }

  // Validar vehículo si viene en el nuevo formato
  let vehicle = null;
  if (vehicleId) {
    const parsedVehicleId = parseInt(vehicleId);
    vehicle = await prisma.vehicle.findUnique({
      where: { id: parsedVehicleId },
    });

    if (!vehicle) {
      throw new Error('VEHICLE_NOT_FOUND');
    }

    if (!vehicle.disponible) {
      throw new Error('VEHICLE_NOT_AVAILABLE');
    }
  }

  return prisma.$transaction(async (tx) => {
    // Asignar vehículo si viene en el nuevo formato
    if (vehicle) {
      await tx.vehicle.update({
        where: { id: vehicle.id },
        data: {
          clientId: parsedClientId,
          disponible: false,
        },
      });
    }

    const financing = await tx.financing.create({
      data: {
        clientId: parsedClientId,
        saldo,
        tasaAnual: config.tasaAnualDefault,
        precioTotal,
        entregaInicial,
        saldoFinanciado: saldo,
      },
    });

    const plan = await tx.installmentPlan.create({
      data: {
        clientId: parsedClientId,
        totalCuotas: cantidadCuotas,
        montoCuota,
        fechaInicio: startDate,
        administrativoPct: adminPct,
        selladoPct: selladPct,
        retiroPct: retirPct,
        precioTotal: precioTotal,
      },
    });

    // Calcular gasto de retiro (se agrega a la cuota 1)
    const gastoRetiro = precioTotal * (retirPct / 100);
    const commissionHelper = require('../helpers/commissionHelper');

    const installmentsData = Array.from({ length: cantidadCuotas }, (_, index) => {
      const numero = index + 1;
      const fechaVencimiento = new Date(startDate);
      fechaVencimiento.setMonth(fechaVencimiento.getMonth() + numero);

      const montoBase = montoCuota;

      // Calcular desglose de cargos SOLO LO QUE PAGA EL CLIENTE
      const cargosDetalle = {
        sellado: 0,
        gastoRetiro: 0,
        mora: 0
      };

      if (numero === 1) {
        // Cuota 1: gasto de retiro
        cargosDetalle.gastoRetiro = gastoRetiro;
      } else {
        // Cuota 2+: sellado (porcentual)
        cargosDetalle.sellado = montoBase * (selladPct / 100);
      }

      // TOTAL VISIBLE AL CLIENTE: monto base + sellado + retiro (si aplica)
      const cargosTotal = cargosDetalle.sellado + cargosDetalle.gastoRetiro + cargosDetalle.mora;
      const total = montoBase + cargosTotal;

      return {
        planId: plan.id,
        numero,
        fechaVencimiento,
        monto: montoBase,
        cargos: cargosTotal,     // backward compatibility
        cargosDetalle,           // nuevo desglose detallado
        total,
        pagado: 0,
        estado: 'PENDIENTE',
      };
    });

    await tx.installment.createMany({ data: installmentsData });

    const installments = await tx.installment.findMany({
      where: { planId: plan.id },
      orderBy: { numero: 'asc' },
    });

    return {
      operation: {
        clientId: parsedClientId,
        precioTotal,
        entregaInicial,
        saldo,
        cantidadCuotas,
        montoCuota,
        fechaInicio: startDate,
        vehicleId: vehicle ? vehicle.id : null,
      },
      financing,
      plan,
      installments,
      vehicle, // Incluir vehículo en la respuesta
    };
  });
};

const getSaleByClientId = async (clientId) => {
  // Primero buscar si hay cuotas activas para el cliente
  const activeInstallments = await prisma.installment.count({
    where: {
      plan: {
        clientId: clientId,
      },
      estado: {
        in: ['PENDIENTE', 'PARCIAL'],
      },
    },
  });

  // Si hay cuotas activas, el cliente tiene una venta
  if (activeInstallments > 0) {
    // Obtener el financing más reciente del cliente
    const financing = await prisma.financing.findFirst({
      where: { clientId: clientId },
      orderBy: { createdAt: 'desc' },
      include: {
        client: {
          select: {
            id: true,
            nombre: true,
          },
        },
      },
    });

    if (financing) {
      return {
        hasSale: true,
        financing: {
          id: financing.id,
          clientId: financing.clientId,
          precioTotal: financing.precioTotal,
          entregaInicial: financing.entregaInicial,
          saldo: financing.saldo,
          createdAt: financing.createdAt,
          client: financing.client,
        },
      };
    }
  }

  // Si no hay cuotas activas, buscar si hay vehículo asignado
  const assignedVehicle = await prisma.vehicle.findFirst({
    where: { 
      clientId: clientId,
      disponible: false 
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

  if (assignedVehicle) {
    return {
      hasSale: true,
      vehicle: {
        id: assignedVehicle.id,
        clientId: assignedVehicle.clientId,
        modelo: assignedVehicle.modelo,
        patente: assignedVehicle.patente,
        createdAt: assignedVehicle.createdAt,
        client: assignedVehicle.client,
      },
    };
  }

  // Si no hay nada, el cliente no tiene venta
  return {
    hasSale: false,
  };
};

module.exports = {
  createSale,
  getSaleByClientId,
};
