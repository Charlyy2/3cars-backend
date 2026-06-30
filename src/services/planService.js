const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const configService = require('./configService');
const cashMovementService = require('./cashMovementService');

/**
 * Crear plan de pago sin vehículo
 */
const createPlan = async ({
  clientId,
  numeroSolicitud,
  montoCuotaBase,
  cantidadCuotas,
  fechaInicio,
  selladoMonto,
  cuotasConSellado,
  administrativoPct,
  cuotaObjetivoRetiro,
  retiroPct,
  observaciones,
  primerCuotaPagada
}) => {
  const parsedClientId = parseInt(clientId);
  const startDate = new Date(fechaInicio);
  const config = await configService.getConfig();

  // Validar cliente existe
  const client = await prisma.client.findUnique({
    where: { id: parsedClientId },
  });

  if (!client) {
    throw new Error('CLIENT_NOT_FOUND');
  }

  // Validar que no tenga plan activo
  const activePlan = await prisma.installmentPlan.findFirst({
    where: {
      clientId: parsedClientId,
      estado: 'ACTIVO',
    },
  });

  if (activePlan) {
    throw new Error('ACTIVE_PLAN_EXISTS');
  }

  // Validar numeroSolicitud único si se proporciona
  if (numeroSolicitud) {
    const existingPlan = await prisma.installmentPlan.findUnique({
      where: { numeroSolicitud }
    });

    if (existingPlan) {
      throw new Error('SOLICITUD_EXISTS');
    }
  }

  return prisma.$transaction(async (tx) => {
    // Crear plan
    const plan = await tx.installmentPlan.create({
      data: {
        numeroSolicitud: numeroSolicitud || null,
        clientId: parsedClientId,
        totalCuotas: cantidadCuotas,
        montoCuotaBase,
        fechaInicio: startDate,
        estado: 'ACTIVO',
        selladoMonto: selladoMonto || 0,
        cuotasConSellado: cuotasConSellado || 2,
        administrativoPct: administrativoPct || 0,
        cuotaObjetivoRetiro: cuotaObjetivoRetiro || 0,
        retiroPct: retiroPct || 0,
        observaciones: observaciones || null,
      },
    });

    // Generar cuotas del plan
    const installmentsData = Array.from({ length: cantidadCuotas }, (_, index) => {
      const numero = index + 1;
      const fechaVencimiento = new Date(startDate);
      fechaVencimiento.setMonth(fechaVencimiento.getMonth() + numero);

      const montoBase = montoCuotaBase;

      // Calcular desglose de cargos SOLO LO QUE PAGA EL CLIENTE
      const cargosDetalle = {
        sellado: 0,
        gastoRetiro: 0,
        mora: 0
      };

      // Sellado solo en primeras N cuotas
      if (numero <= plan.cuotasConSellado) {
        cargosDetalle.sellado = plan.selladoMonto;
      }

      // TOTAL VISIBLE AL CLIENTE: monto base + sellado + retiro (si aplica)
      const cargosTotal = cargosDetalle.sellado + cargosDetalle.gastoRetiro + cargosDetalle.mora;
      const total = montoBase + cargosTotal;

      // Si primerCuotaPagada es true y es la primera cuota, marcar como pagada
      const isFirstInstallmentPaid = primerCuotaPagada && numero === 1;

      return {
        planId: plan.id,
        numero,
        fechaVencimiento,
        monto: montoBase,
        cargos: cargosTotal,
        cargosDetalle,
        total,
        pagado: isFirstInstallmentPaid ? total : 0,
        estado: isFirstInstallmentPaid ? 'PAGADO' : 'PENDIENTE',
      };
    });

    await tx.installment.createMany({ data: installmentsData });

    // Si primerCuotaPagada es true, crear un pago para la primera cuota
    if (primerCuotaPagada && installmentsData.length > 0) {
      const firstInstallment = installmentsData[0];

      await tx.payment.create({
        data: {
          clientId: parsedClientId,
          montoTotal: firstInstallment.total,
          montoAplicado: firstInstallment.total,
          montoAdmin: 0,
          fecha: new Date(),
        },
      });

      // Crear allocation para el pago
      const payment = await tx.payment.findFirst({
        where: {
          clientId: parsedClientId,
          montoTotal: firstInstallment.total,
        },
        orderBy: {
          id: 'desc',
        },
      });

      if (payment) {
        // Obtener la cuota creada
        const installment = await tx.installment.findFirst({
          where: {
            planId: plan.id,
            numero: 1,
          },
        });

        if (installment) {
          await tx.paymentAllocation.create({
            data: {
              paymentId: payment.id,
              installmentId: installment.id,
              monto: firstInstallment.total,
            },
          });

          // Devengar la primera cuota en caja (dentro de la misma transacción)
          await cashMovementService.recordInstallmentPaid(
            installment,
            { clientId: parsedClientId, paymentId: payment.id, config },
            tx
          );
        }
      }
    }

    const installments = await tx.installment.findMany({
      where: { planId: plan.id },
      orderBy: { numero: 'asc' },
    });

    return {
      plan,
      installments,
    };
  });
};

/**
 * Retirar vehículo y crear financiación
 */
const retirarVehiculo = async (planId, vehicleId) => {
  const parsedPlanId = parseInt(planId);
  const parsedVehicleId = parseInt(vehicleId);

  // Obtener plan con cuotas
  const plan = await prisma.installmentPlan.findUnique({
    where: { id: parsedPlanId },
    include: {
      installments: {
        orderBy: { numero: 'asc' }
      },
      client: true
    }
  });

  if (!plan) {
    throw new Error('PLAN_NOT_FOUND');
  }

  if (plan.estado !== 'ACTIVO') {
    throw new Error('PLAN_NOT_ACTIVE');
  }

  if (plan.vehicleId) {
    throw new Error('VEHICLE_ALREADY_WITHDRAWN');
  }

  // Validar vehículo
  const vehicle = await prisma.vehicle.findUnique({
    where: { id: parsedVehicleId },
  });

  if (!vehicle) {
    throw new Error('VEHICLE_NOT_FOUND');
  }

  if (!vehicle.disponible) {
    throw new Error('VEHICLE_NOT_AVAILABLE');
  }

  // Calcular cuotas pagadas
  const cuotasPagadas = plan.installments.filter(c => c.estado === 'PAGADO').length;
  
  if (cuotasPagadas < plan.cuotaObjetivoRetiro) {
    throw new Error('INSUFFICIENT_INSTALLMENTS_PAID');
  }

  // Calcular montos
  const montoPagado = plan.installments.reduce((sum, c) => sum + c.pagado, 0);
  const saldoRestante = plan.installments
    .filter(c => c.estado !== 'PAGADO')
    .reduce((sum, c) => sum + (c.total - c.pagado), 0);
  
  const montoRetiro = saldoRestante * (plan.retiroPct / 100);
  const saldoFinal = saldoRestante + montoRetiro;

  const config = await configService.getConfig();

  return prisma.$transaction(async (tx) => {
    // Actualizar plan
    await tx.installmentPlan.update({
      where: { id: parsedPlanId },
      data: {
        vehicleId: parsedVehicleId,
        fechaRetiro: new Date(),
        montoRetiro,
        saldoAlRetiro: saldoRestante,
        estado: 'RETIRADO',
      },
    });

    // Asignar vehículo al cliente
    await tx.vehicle.update({
      where: { id: parsedVehicleId },
      data: {
        clientId: plan.clientId,
        disponible: false,
      },
    });

    // Crear financiación
    const financing = await tx.financing.create({
      data: {
        planId: parsedPlanId,
        clientId: plan.clientId,
        vehicleId: parsedVehicleId,
        saldoInicial: saldoFinal,
        tasaAnual: config.tasaAnualDefault,
        precioVehiculo: vehicle.precio,
        montoRetiro,
        cuotasPagadas,
        montoPagado,
      },
    });

    // Agregar cargo de retiro a la siguiente cuota pendiente
    const siguienteCuotaPendiente = plan.installments.find(c => c.estado === 'PENDIENTE');
    
    if (siguienteCuotaPendiente) {
      const cargosActuales = siguienteCuotaPendiente.cargosDetalle || {
        gastoRetiro: 0,
        sellado: 0,
        mora: 0
      };

      const nuevosCargos = {
        ...cargosActuales,
        gastoRetiro: montoRetiro
      };

      const nuevoTotal = siguienteCuotaPendiente.monto + 
                         nuevosCargos.gastoRetiro + 
                         nuevosCargos.sellado + 
                         nuevosCargos.mora;

      await tx.installment.update({
        where: { id: siguienteCuotaPendiente.id },
        data: {
          cargosDetalle: nuevosCargos,
          cargos: nuevosCargos.gastoRetiro + 
                  nuevosCargos.sellado + 
                  nuevosCargos.mora,
          total: nuevoTotal,
        },
      });
    }

    const updatedPlan = await tx.installmentPlan.findUnique({
      where: { id: parsedPlanId },
      include: {
        installments: {
          orderBy: { numero: 'asc' }
        },
        vehicle: true,
      },
    });

    return {
      plan: updatedPlan,
      financing,
      vehicle,
    };
  });
};

/**
 * Obtener plan por ID
 */
const getPlanById = async (planId) => {
  const plan = await prisma.installmentPlan.findUnique({
    where: { id: parseInt(planId) },
    include: {
      client: true,
      installments: {
        orderBy: { numero: 'asc' }
      },
      vehicle: true,
      financing: true,
    },
  });

  if (!plan) {
    throw new Error('PLAN_NOT_FOUND');
  }

  return plan;
};

/**
 * Obtener plan por cliente
 */
const getPlanByClientId = async (clientId) => {
  const plan = await prisma.installmentPlan.findFirst({
    where: {
      clientId: parseInt(clientId),
      estado: { in: ['ACTIVO', 'NEGOCIACION', 'RESUELTO'] }
    },
    include: {
      client: true,
      installments: {
        orderBy: { numero: 'asc' }
      },
      vehicle: true,
      financing: true,
    },
    orderBy: { fechaInicio: 'desc' },
  });

  return plan;
};

/**
 * Pasar un plan a NEGOCIACION (cuando alcanzó la cuota objetivo de retiro).
 * Habilita la acción de "registrar entrega de capital".
 */
const marcarNegociacion = async (planId) => {
  const parsedPlanId = parseInt(planId);

  const plan = await prisma.installmentPlan.findUnique({
    where: { id: parsedPlanId },
    include: { installments: true },
  });

  if (!plan) throw new Error('PLAN_NOT_FOUND');
  if (plan.estado !== 'ACTIVO') throw new Error('PLAN_NOT_ACTIVE');

  const cuotasPagadas = plan.installments.filter((c) => c.estado === 'PAGADO').length;
  if (cuotasPagadas < plan.cuotaObjetivoRetiro) {
    throw new Error('INSUFFICIENT_INSTALLMENTS_PAID');
  }

  return prisma.installmentPlan.update({
    where: { id: parsedPlanId },
    data: { estado: 'NEGOCIACION' },
  });
};

/**
 * Registrar una entrega de capital sobre un plan en NEGOCIACION.
 * Genera automáticamente un CashMovement INGRESO / ENTREGA_CAPITAL.
 */
const registrarEntregaCapital = async (planId, { monto, observacion, createdBy }) => {
  const parsedPlanId = parseInt(planId);
  const amount = Number(monto);

  if (isNaN(amount) || amount <= 0) {
    throw new Error('INVALID_AMOUNT');
  }

  const plan = await prisma.installmentPlan.findUnique({
    where: { id: parsedPlanId },
    include: { client: true },
  });

  if (!plan) throw new Error('PLAN_NOT_FOUND');
  if (plan.estado !== 'NEGOCIACION') throw new Error('PLAN_NOT_IN_NEGOTIATION');

  return prisma.$transaction(async (tx) => {
    const movement = await cashMovementService.recordCapitalDelivery(
      {
        clientId: plan.clientId,
        planId: parsedPlanId,
        amount,
        description: observacion || `Entrega de capital (plan #${parsedPlanId})`,
        createdBy,
      },
      tx
    );

    return { plan, movement };
  });
};

const roundCurrency = (v) => Math.round((Number(v || 0) + Number.EPSILON) * 100) / 100;
const { CAT } = require('../constants/cashCategories');
const { ORIGIN } = cashMovementService;

/**
 * RESOLVER PLAN — flujo único de resolución (reemplaza negociación/retiro/devolución).
 * Todos los bloques son OPCIONALES; el operador registra solo lo que ocurrió.
 *
 * @param {number} planId
 * @param {object} data
 *   - vehiculo: 'NO_RETIRO' | 'AUTO' | 'MOTO'                (opcional, default NO_RETIRO)
 *   - entrega:  { monto, comisionPct }                       (opcional)
 *   - gastoRetiro: { cobrado, real }                         (opcional)
 *   - devolucion: { monto }                                  (opcional)
 *   - observacion: string                                    (opcional)
 *   - createdBy: string
 *
 * Genera automáticamente (solo si el monto > 0):
 *   - INGRESO ENTREGA_CAPITAL        (entrega.monto)
 *   - EGRESO  COMISION_NEGOCIACION   (entrega.monto * comisionPct/100; 0% => no genera)
 *   - INGRESO GASTO_RETIRO_COBRADO   (gastoRetiro.cobrado)
 *   - EGRESO  GASTO_RETIRO_REAL      (gastoRetiro.real)
 *   - EGRESO  DEVOLUCION             (devolucion.monto)
 *
 * Deja el plan en estado RESUELTO. Las cuotas pendientes quedan como están.
 */
const resolverPlan = async (planId, data = {}) => {
  const parsedPlanId = parseInt(planId);
  const {
    vehiculo = 'NO_RETIRO',
    entrega = null,
    gastoRetiro = null,
    devolucion = null,
    observacion = null,
    createdBy = null,
    // Datos del vehículo retirado + archivos (opcionales; relevantes si retiró)
    vehiculoData = null, // { marca, modelo, anio, patente }
    boletoCompraventa = null, // path/URL imagen
    contratoMutuo = null,     // path/URL pdf
  } = data;

  // Validar enum de vehículo
  const RESULTADOS = ['NO_RETIRO', 'AUTO', 'MOTO'];
  if (!RESULTADOS.includes(vehiculo)) throw new Error('INVALID_VEHICLE_RESULT');

  const plan = await prisma.installmentPlan.findUnique({
    where: { id: parsedPlanId },
    include: { installments: true, client: true },
  });
  if (!plan) throw new Error('PLAN_NOT_FOUND');
  // Se puede resolver desde ACTIVO o NEGOCIACION (estado intermedio del flujo viejo).
  if (!['ACTIVO', 'NEGOCIACION'].includes(plan.estado)) throw new Error('PLAN_NOT_RESOLVABLE');

  // Precondición de negocio: haber alcanzado la cuota objetivo.
  const cuotasPagadas = plan.installments.filter((c) => c.estado === 'PAGADO').length;
  if (cuotasPagadas < plan.cuotaObjetivoRetiro) throw new Error('INSUFFICIENT_INSTALLMENTS_PAID');

  // Normalizar montos de los bloques
  const entregaMonto = entrega ? roundCurrency(entrega.monto) : 0;
  const comisionPct = entrega ? Number(entrega.comisionPct || 0) : 0;
  const comisionMonto = roundCurrency(entregaMonto * (comisionPct / 100));
  const retiroCobrado = gastoRetiro ? roundCurrency(gastoRetiro.cobrado) : 0;
  const retiroReal = gastoRetiro ? roundCurrency(gastoRetiro.real) : 0;
  const devolucionMonto = devolucion ? roundCurrency(devolucion.monto) : 0;

  // Validaciones básicas (no negativos)
  [entregaMonto, comisionMonto, retiroCobrado, retiroReal, devolucionMonto].forEach((v) => {
    if (v < 0) throw new Error('NEGATIVE_AMOUNT');
  });
  if (comisionPct < 0 || comisionPct > 100) throw new Error('INVALID_COMMISSION_PCT');

  const clientId = plan.clientId;
  const ref = `(plan #${parsedPlanId})`;

  return prisma.$transaction(async (tx) => {
    const movements = [];
    const push = (m) => { if (m) movements.push(m); };

    // --- Bloque Entrega de capital ---
    if (entregaMonto > 0) {
      push(await cashMovementService.recordResolutionMovement({
        categoryName: CAT.ENTREGA_CAPITAL, amount: entregaMonto, origin: ORIGIN.CAPITAL_DELIVERY,
        description: `Entrega de capital ${ref}`, clientId, createdBy,
      }, tx));
      // Comisión de negociación (solo si > 0)
      if (comisionMonto > 0) {
        push(await cashMovementService.recordResolutionMovement({
          categoryName: CAT.COMISION_NEGOCIACION, amount: comisionMonto, origin: ORIGIN.SYSTEM,
          description: `Comisión de negociación ${comisionPct}% ${ref}`, clientId, createdBy,
        }, tx));
      }
    }

    // --- Bloque Gastos de retiro ---
    if (retiroCobrado > 0) {
      push(await cashMovementService.recordResolutionMovement({
        categoryName: CAT.GASTO_RETIRO_COBRADO, amount: retiroCobrado, origin: ORIGIN.WITHDRAWAL,
        description: `Gasto de retiro cobrado ${ref}`, clientId, createdBy,
      }, tx));
    }
    if (retiroReal > 0) {
      push(await cashMovementService.recordResolutionMovement({
        categoryName: CAT.GASTO_RETIRO_REAL, amount: retiroReal, origin: ORIGIN.WITHDRAWAL,
        description: `Gasto de retiro real ${ref}`, clientId, createdBy,
      }, tx));
    }

    // --- Bloque Devolución ---
    if (devolucionMonto > 0) {
      push(await cashMovementService.recordResolutionMovement({
        categoryName: CAT.DEVOLUCION, amount: devolucionMonto, origin: ORIGIN.SYSTEM,
        description: `Devolución ${ref}`, clientId, createdBy,
      }, tx));
    }

    // --- Cerrar el plan ---
    const resolucionDetalle = {
      vehiculo,
      entrega: entrega ? { monto: entregaMonto, comisionPct, comisionMonto } : null,
      gastoRetiro: gastoRetiro ? { cobrado: retiroCobrado, real: retiroReal, margen: roundCurrency(retiroCobrado - retiroReal) } : null,
      devolucion: devolucion ? { monto: devolucionMonto } : null,
      observacion: observacion || null,
    };
    const retiro = vehiculo === 'AUTO' || vehiculo === 'MOTO';
    const updatedPlan = await tx.installmentPlan.update({
      where: { id: parsedPlanId },
      data: {
        estado: 'RESUELTO',
        fechaResolucion: new Date(),
        resultadoVehiculo: vehiculo,
        resolucionDetalle,
        // Datos del vehículo y archivos (solo si retiró)
        vehiculoMarca: retiro ? (vehiculoData?.marca || null) : null,
        vehiculoModelo: retiro ? (vehiculoData?.modelo || null) : null,
        vehiculoAnio: retiro && vehiculoData?.anio ? parseInt(vehiculoData.anio) : null,
        vehiculoPatente: retiro ? (vehiculoData?.patente || null) : null,
        boletoCompraventa: retiro ? (boletoCompraventa || null) : null,
        contratoMutuo: retiro ? (contratoMutuo || null) : null,
      },
    });

    return { plan: updatedPlan, movements, resumen: resolucionDetalle };
  });
};

/**
 * INICIAR SALDO — genera las cuotas de la etapa SALDO (post-resolución).
 * Se llama aparte porque la entrega del auto puede diferir de la negociación.
 * Las cuotas arrancan el mes siguiente a la fecha de entrega del auto.
 *
 * @param {number} planId
 * @param {object} data - { fechaEntrega, cantidadCuotas, montoCuota }
 */
const iniciarSaldo = async (planId, { fechaEntrega, cantidadCuotas, montoCuota }) => {
  const parsedPlanId = parseInt(planId);
  const cantidad = parseInt(cantidadCuotas);
  const monto = roundCurrency(montoCuota);

  if (isNaN(cantidad) || cantidad <= 0) throw new Error('INVALID_SALDO_CANTIDAD');
  if (isNaN(monto) || monto <= 0) throw new Error('INVALID_SALDO_MONTO');

  const entrega = fechaEntrega ? new Date(fechaEntrega) : new Date();
  if (isNaN(entrega.getTime())) throw new Error('INVALID_FECHA_ENTREGA');

  const plan = await prisma.installmentPlan.findUnique({ where: { id: parsedPlanId } });
  if (!plan) throw new Error('PLAN_NOT_FOUND');
  if (plan.estado !== 'RESUELTO') throw new Error('PLAN_NOT_RESOLVED'); // saldo solo tras resolver
  if (plan.saldoIniciado) throw new Error('SALDO_ALREADY_STARTED');

  return prisma.$transaction(async (tx) => {
    // Generar cuotas: la primera vence el mes SIGUIENTE a la entrega del auto.
    const saldoCuotas = [];
    for (let i = 1; i <= cantidad; i++) {
      const fechaVencimiento = new Date(entrega);
      fechaVencimiento.setMonth(fechaVencimiento.getMonth() + i);
      saldoCuotas.push({
        planId: parsedPlanId,
        clientId: plan.clientId,
        numero: i,
        fechaVencimiento,
        monto,
        pagado: 0,
        estado: 'PENDIENTE',
      });
    }
    await tx.saldoCuota.createMany({ data: saldoCuotas });

    const updatedPlan = await tx.installmentPlan.update({
      where: { id: parsedPlanId },
      data: {
        saldoIniciado: true,
        fechaEntregaAuto: entrega,
        saldoTotalCuotas: cantidad,
        saldoMontoCuota: monto,
      },
    });

    const cuotas = await tx.saldoCuota.findMany({
      where: { planId: parsedPlanId },
      orderBy: { numero: 'asc' },
    });

    return { plan: updatedPlan, saldoCuotas: cuotas };
  });
};

const getSaldoByClientId = async (clientId) => {
  const parsedClientId = parseInt(clientId);
  const plan = await prisma.installmentPlan.findFirst({
    where: { clientId: parsedClientId, saldoIniciado: true },
    include: { saldoCuotas: { orderBy: { numero: 'asc' } } },
    orderBy: { id: 'desc' },
  });
  if (!plan) return null;
  return {
    planId: plan.id,
    fechaEntregaAuto: plan.fechaEntregaAuto,
    totalCuotas: plan.saldoTotalCuotas,
    montoCuota: plan.saldoMontoCuota,
    cuotas: plan.saldoCuotas,
  };
};

/**
 * Cancelar plan (dar de baja)
 */
const cancelPlan = async (planId) => {
  const parsedPlanId = parseInt(planId);

  const plan = await prisma.installmentPlan.findUnique({
    where: { id: parsedPlanId },
    include: {
      client: true,
      installments: true
    }
  });

  if (!plan) {
    throw new Error('PLAN_NOT_FOUND');
  }

  if (plan.estado !== 'ACTIVO') {
    throw new Error('PLAN_NOT_ACTIVE');
  }

  return prisma.$transaction(async (tx) => {
    const updatedPlan = await tx.installmentPlan.update({
      where: { id: parsedPlanId },
      data: {
        estado: 'CAIDO',
      },
    });

    return updatedPlan;
  });
};

/**
 * Obtener planes caídos con información de cliente
 */
const getFallenPlans = async () => {
  const fallenPlans = await prisma.installmentPlan.findMany({
    where: {
      estado: 'CAIDO'
    },
    include: {
      client: {
        select: {
          id: true,
          nombre: true,
          createdAt: true
        }
      },
      installments: {
        orderBy: { numero: 'asc' }
      }
    },
    orderBy: {
      fechaInicio: 'desc'
    }
  });

  return fallenPlans;
};

/**
 * Verificar y cancelar automáticamente planes con 3 meses de mora
 */
const checkAndCancelOverduePlans = async () => {
  const today = new Date();

  // Obtener todos los planes activos
  const activePlans = await prisma.installmentPlan.findMany({
    where: {
      estado: 'ACTIVO'
    },
    include: {
      client: true,
      installments: {
        orderBy: { numero: 'asc' }
      }
    }
  });

  const plansToCancel = [];

  for (const plan of activePlans) {
    let consecutiveUnpaid = 0;
    let maxConsecutiveUnpaid = 0;

    for (const installment of plan.installments) {
      const isOverdue = installment.fechaVencimiento < today;
      const isUnpaid = installment.estado !== 'PAGADO';

      if (isOverdue && isUnpaid) {
        consecutiveUnpaid++;
        maxConsecutiveUnpaid = Math.max(maxConsecutiveUnpaid, consecutiveUnpaid);
      } else {
        consecutiveUnpaid = 0;
      }
    }

    // Si tiene 3 o más cuotas consecutivas vencidas e impagas, cancelar
    if (maxConsecutiveUnpaid >= 3) {
      plansToCancel.push(plan.id);
    }
  }

  // Cancelar los planes identificados
  const cancelledPlans = [];
  for (const planId of plansToCancel) {
    try {
      const cancelled = await cancelPlan(planId);
      cancelledPlans.push(cancelled);
    } catch (error) {
      console.error(`Error al cancelar plan ${planId}:`, error);
    }
  }

  return {
    cancelledCount: cancelledPlans.length,
    cancelledPlans
  };
};

module.exports = {
  createPlan,
  retirarVehiculo,
  getPlanById,
  getPlanByClientId,
  cancelPlan,
  getFallenPlans,
  checkAndCancelOverduePlans,
  marcarNegociacion,
  registrarEntregaCapital,
  resolverPlan,
  iniciarSaldo,
  getSaldoByClientId,
};
