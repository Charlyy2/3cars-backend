const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const configService = require('./configService');
const cashMovementService = require('./cashMovementService');
const { lockPlan } = require('../helpers/lockHelper');
const { evaluarObjetivo, isCuotaSaldada, deudaEfectivaCuota } = require('../helpers/objetivoHelper');

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

  // Regla única del objetivo (pagado real + ajustes)
  if (!evaluarObjetivo(plan, plan.installments).objetivoCumplido) {
    throw new Error('INSUFFICIENT_INSTALLMENTS_PAID');
  }

  // Calcular montos
  const montoPagado = plan.installments.reduce((sum, c) => sum + c.pagado, 0);
  // Deuda efectiva: lo ajustado/condonado ya no se debe
  const saldoRestante = plan.installments
    .filter(c => !isCuotaSaldada(c.estado))
    .reduce((sum, c) => sum + deudaEfectivaCuota(c), 0);
  
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
// Relaciones del plan que la UI necesita para mostrar objetivo, ajustes y entregas.
const PLAN_DETAIL_INCLUDE = {
  client: true,
  installments: { orderBy: { numero: 'asc' } },
  vehicle: true,
  financing: true,
  ajustes: { orderBy: { createdAt: 'desc' }, include: { installment: { select: { numero: true } } } },
  entregasCapital: { orderBy: { createdAt: 'desc' } },
};

// Agrega el resumen del objetivo calculado por la regla de dominio única.
const withObjetivo = (plan) => (plan ? { ...plan, objetivo: evaluarObjetivo(plan, plan.installments) } : plan);

const getPlanById = async (planId) => {
  const plan = await prisma.installmentPlan.findUnique({
    where: { id: parseInt(planId) },
    include: PLAN_DETAIL_INCLUDE,
  });

  if (!plan) {
    throw new Error('PLAN_NOT_FOUND');
  }

  return withObjetivo(plan);
};

/**
 * Obtener plan por cliente
 */
const getPlanByClientId = async (clientId) => {
  const includeShape = PLAN_DETAIL_INCLUDE;

  let plan = await prisma.installmentPlan.findFirst({
    where: {
      clientId: parseInt(clientId),
      estado: { in: ['ACTIVO', 'NEGOCIACION', 'RESUELTO'] }
    },
    include: includeShape,
    orderBy: { fechaInicio: 'desc' },
  });

  // "Pago abierto": generar (lazy) las cuotas mensuales que hayan vencido y recargar.
  if (plan && plan.pagoAbierto && plan.estado === 'ACTIVO') {
    const res = await materializeOpenInstallments(plan.id, prisma);
    if (res.added > 0) {
      plan = await prisma.installmentPlan.findFirst({
        where: { id: plan.id },
        include: includeShape,
      });
    }
  }

  return withObjetivo(plan);
};

/**
 * Pasar un plan a NEGOCIACION (cuando alcanzó la cuota objetivo de retiro).
 * Habilita la acción de "registrar entrega de capital".
 */
const marcarNegociacion = async (planId) => {
  const parsedPlanId = parseInt(planId);

  return prisma.$transaction(async (tx) => {
    // Serializado con pagos/ajustes: la regla se evalúa sobre datos confirmados.
    await lockPlan(tx, parsedPlanId);
    const plan = await tx.installmentPlan.findUnique({
      where: { id: parsedPlanId },
      include: { installments: true },
    });

    if (!plan) throw new Error('PLAN_NOT_FOUND');
    if (plan.estado !== 'ACTIVO') throw new Error('PLAN_NOT_ACTIVE');
    if (!evaluarObjetivo(plan, plan.installments).puedeNegociar) {
      throw new Error('INSUFFICIENT_INSTALLMENTS_PAID');
    }

    return tx.installmentPlan.update({
      where: { id: parsedPlanId },
      data: { estado: 'NEGOCIACION' },
    });
  });
};

/**
 * Registrar una entrega de capital sobre un plan en NEGOCIACION.
 * Genera automáticamente un CashMovement INGRESO / ENTREGA_CAPITAL.
 */
const roundCurrency = (v) => Math.round((Number(v || 0) + Number.EPSILON) * 100) / 100;
const { CAT } = require('../constants/cashCategories');
const { ORIGIN } = cashMovementService;

// ============================================================
// ENTREGA DE CAPITAL — DINERO | VEHICULO | MIXTA
// ============================================================
//   valorTotal  = montoDinero + vehiculo.valorToma   (valor económico, lo calcula el backend)
//   impactoCaja = montoDinero                        (la toma de un vehículo NO es dinero)
// NO existe comisión de negociación (regla de negocio): ni sobre el dinero, ni
// sobre la toma, ni sobre el total. `comisionPct` se acepta en el payload solo por
// compatibilidad con clientes viejos y se ignora.

const TIPOS_ENTREGA = ['DINERO', 'VEHICULO', 'MIXTA'];

const normalizarPatente = (p) => String(p || '').trim().toUpperCase().replace(/\s+/g, '');

const normalizarVehiculoToma = (v) => {
  if (!v || typeof v !== 'object') throw new Error('VEHICULO_REQUERIDO');
  const valorToma = roundCurrency(v.valorToma);
  if (!Number.isFinite(Number(v.valorToma)) || !(valorToma > 0)) throw new Error('INVALID_VALOR_TOMA');
  const patente = normalizarPatente(v.patente);
  if (!patente) throw new Error('VEHICULO_PATENTE_REQUERIDA');
  const anio = Number(v.anio);
  const anioMax = new Date().getFullYear() + 1;
  if (!Number.isInteger(anio) || anio < 1900 || anio > anioMax) throw new Error('VEHICULO_ANIO_INVALIDO');
  const marca = String(v.marca || '').trim();
  if (!marca) throw new Error('VEHICULO_MARCA_REQUERIDA');
  const modelo = String(v.modelo || '').trim();
  if (!modelo) throw new Error('VEHICULO_MODELO_REQUERIDO');
  const observaciones = String(v.observaciones || '').trim() || null;
  return { valorToma, patente, anio, marca, modelo, observaciones };
};

/**
 * Valida y normaliza una entrega de capital. Ignora cualquier total enviado por el
 * front y cualquier `comisionPct` (no existe comisión de negociación).
 * Compatibilidad: sin `tipoEntrega` se interpreta como DINERO y `monto` se acepta
 * como alias de `montoDinero` (payload anterior).
 * Devuelve null si es una entrega en DINERO de $0 (antes no generaba nada).
 */
const normalizarEntrega = (entrega) => {
  if (!entrega) return null;
  const tipoEntrega = String(entrega.tipoEntrega || 'DINERO').trim().toUpperCase();
  if (!TIPOS_ENTREGA.includes(tipoEntrega)) throw new Error('INVALID_TIPO_ENTREGA');

  const rawDinero = entrega.montoDinero !== undefined && entrega.montoDinero !== null ? entrega.montoDinero : entrega.monto;
  const montoDinero = tipoEntrega === 'VEHICULO' ? 0 : roundCurrency(rawDinero);
  if (!Number.isFinite(montoDinero)) throw new Error('INVALID_AMOUNT');
  if (montoDinero < 0) throw new Error('NEGATIVE_AMOUNT');

  if (tipoEntrega === 'DINERO' && montoDinero === 0) return null;
  if (tipoEntrega === 'MIXTA' && !(montoDinero > 0)) throw new Error('INVALID_AMOUNT');

  const vehiculo = tipoEntrega === 'DINERO' ? null : normalizarVehiculoToma(entrega.vehiculo);
  const valorTotal = roundCurrency(montoDinero + (vehiculo ? vehiculo.valorToma : 0));

  return { tipoEntrega, montoDinero, vehiculo, valorTotal, impactoCaja: montoDinero };
};

/**
 * Registra una entrega ya normalizada, dentro de la transacción recibida:
 *  - CashMovement INGRESO ENTREGA_CAPITAL SOLO por la parte en dinero (si > 0);
 *  - fila EntregaCapital con el valor económico y los datos del vehículo tomado.
 * No genera ningún egreso de comisión. La entrega es inmutable (no se edita ni borra).
 */
const registrarEntregaNormalizada = async (tx, { plan, entrega, observacion, createdBy }) => {
  const ref = `(plan #${plan.id})`;
  const veh = entrega.vehiculo;
  const movements = [];

  let dineroMovement = null;
  if (entrega.montoDinero > 0) {
    const detalle = entrega.tipoEntrega === 'MIXTA'
      ? ` — parte en dinero de entrega mixta; toma de vehículo ${veh.patente} ($${veh.valorToma}) no ingresa a caja`
      : '';
    dineroMovement = await cashMovementService.recordResolutionMovement({
      categoryName: CAT.ENTREGA_CAPITAL, amount: entrega.montoDinero, origin: ORIGIN.CAPITAL_DELIVERY,
      description: `${observacion || 'Entrega de capital'} ${ref}${detalle}`, clientId: plan.clientId, createdBy,
    }, tx);
    movements.push(dineroMovement);
  }

  const entregaCapital = await tx.entregaCapital.create({
    data: {
      planId: plan.id,
      clientId: plan.clientId,
      tipoEntrega: entrega.tipoEntrega,
      montoDinero: entrega.montoDinero,
      vehiculoValorToma: veh ? veh.valorToma : null,
      vehiculoPatente: veh ? veh.patente : null,
      vehiculoAnio: veh ? veh.anio : null,
      vehiculoMarca: veh ? veh.marca : null,
      vehiculoModelo: veh ? veh.modelo : null,
      vehiculoObservaciones: veh ? veh.observaciones : null,
      valorTotal: entrega.valorTotal,
      cashMovementId: dineroMovement ? dineroMovement.id : null,
      observacion: observacion || null,
      createdBy: createdBy || null,
    },
  });

  return { entregaCapital, movement: dineroMovement, movements };
};

/**
 * Registrar una entrega de capital sobre un plan en NEGOCIACION (flujo viejo).
 * Acepta DINERO | VEHICULO | MIXTA; solo la parte en dinero impacta Caja.
 */
const registrarEntregaCapital = async (planId, { monto, tipoEntrega, montoDinero, vehiculo, observacion, createdBy }) => {
  const parsedPlanId = parseInt(planId);
  const entrega = normalizarEntrega({ monto, tipoEntrega, montoDinero, vehiculo });
  if (!entrega) throw new Error('INVALID_AMOUNT');

  return prisma.$transaction(async (tx) => {
    await lockPlan(tx, parsedPlanId);
    const plan = await tx.installmentPlan.findUnique({
      where: { id: parsedPlanId },
      include: { client: true },
    });

    if (!plan) throw new Error('PLAN_NOT_FOUND');
    if (plan.estado !== 'NEGOCIACION') throw new Error('PLAN_NOT_IN_NEGOTIATION');

    const result = await registrarEntregaNormalizada(tx, { plan, entrega, observacion, createdBy });
    return { plan, movement: result.movement, movements: result.movements, entregaCapital: result.entregaCapital };
  });
};

/**
 * RESOLVER PLAN — flujo único de resolución (reemplaza negociación/retiro/devolución).
 * Todos los bloques son OPCIONALES; el operador registra solo lo que ocurrió.
 *
 * @param {number} planId
 * @param {object} data
 *   - vehiculo: 'NO_RETIRO' | 'AUTO' | 'MOTO'                (opcional, default NO_RETIRO)
 *   - entrega:  { tipoEntrega, montoDinero|monto, vehiculo } (opcional; comisionPct se ignora)
 *               tipoEntrega: DINERO (default) | VEHICULO | MIXTA
 *   - gastoRetiro: { cobrado, real }                         (opcional)
 *   - devolucion: { monto }                                  (opcional)
 *   - observacion: string                                    (opcional)
 *   - createdBy: string
 *
 * Genera automáticamente (solo si el monto > 0):
 *   - INGRESO ENTREGA_CAPITAL        (SOLO la parte en dinero de la entrega)
 *   (No existe comisión de negociación: nunca se genera COMISION_NEGOCIACION.)
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

  // Normalizar montos de los bloques (validación antes de abrir la transacción)
  const entregaNorm = normalizarEntrega(entrega);
  const retiroCobrado = gastoRetiro ? roundCurrency(gastoRetiro.cobrado) : 0;
  const retiroReal = gastoRetiro ? roundCurrency(gastoRetiro.real) : 0;
  const devolucionMonto = devolucion ? roundCurrency(devolucion.monto) : 0;

  // Validaciones básicas (no negativos)
  [retiroCobrado, retiroReal, devolucionMonto].forEach((v) => {
    if (v < 0) throw new Error('NEGATIVE_AMOUNT');
  });

  const ref = `(plan #${parsedPlanId})`;

  return prisma.$transaction(async (tx) => {
    // Lock del plan: la precondición se evalúa sobre datos confirmados y no puede
    // cambiar (pago/ajuste/anulación concurrente) antes de cerrar el plan.
    await lockPlan(tx, parsedPlanId);
    const plan = await tx.installmentPlan.findUnique({
      where: { id: parsedPlanId },
      include: { installments: true, client: true },
    });
    if (!plan) throw new Error('PLAN_NOT_FOUND');
    // Se puede resolver desde ACTIVO o NEGOCIACION (estado intermedio del flujo viejo).
    if (!['ACTIVO', 'NEGOCIACION'].includes(plan.estado)) throw new Error('PLAN_NOT_RESOLVABLE');

    // Precondición de negocio: objetivo cumplido (pagado real + ajustes). Regla única.
    const objetivo = evaluarObjetivo(plan, plan.installments);
    if (!objetivo.puedeNegociar) {
      const err = new Error('INSUFFICIENT_INSTALLMENTS_PAID');
      err.objetivo = objetivo;
      throw err;
    }

    const clientId = plan.clientId;
    const movements = [];
    const push = (m) => { if (m) movements.push(m); };

    // --- Bloque Entrega de capital (solo la parte en dinero impacta Caja) ---
    let entregaCapital = null;
    if (entregaNorm) {
      const r = await registrarEntregaNormalizada(tx, { plan, entrega: entregaNorm, observacion: null, createdBy });
      r.movements.forEach(push);
      entregaCapital = r.entregaCapital;
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
      // `monto` se mantiene por compatibilidad = dinero entregado (lo que impacta Caja).
      entrega: entregaNorm ? {
        tipoEntrega: entregaNorm.tipoEntrega,
        monto: entregaNorm.montoDinero,
        montoDinero: entregaNorm.montoDinero,
        vehiculo: entregaNorm.vehiculo,
        valorTotal: entregaNorm.valorTotal,
        impactoCaja: entregaNorm.impactoCaja,
        entregaCapitalId: entregaCapital ? entregaCapital.id : null,
      } : null,
      // Composición del objetivo al momento de negociar (pagado real vs ajustado).
      objetivo: {
        objetivoOriginal: objetivo.objetivoOriginal,
        pagadoReal: objetivo.pagadoReal,
        ajustesAplicados: objetivo.ajustesAplicados,
        saldoPendienteEfectivo: objetivo.saldoPendienteEfectivo,
      },
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

    return { plan: updatedPlan, movements, entregaCapital, resumen: resolucionDetalle };
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
      const isUnpaid = !isCuotaSaldada(installment.estado);

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

// ============================================================
// PAGO ABIERTO — el plan sigue sumando cuotas mensuales tras la cuota objetivo
// ============================================================

const _addMonths = (d, n) => { const x = new Date(d); x.setMonth(x.getMonth() + n); return x; };
const _endOfMonth = (d) => new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999);

/**
 * Materializa las cuotas mensuales que correspondan para un plan en "pago abierto".
 * Agrega una cuota por cada mes transcurrido más allá de la última cuota (mismo
 * monto base, sin sellado/retiro). Con `seed: true`, si no quedara ninguna cuota
 * impaga, siembra la próxima para que el cliente pueda pagar en el acto.
 *
 * Idempotente: si no hay meses nuevos que cubrir, no crea nada.
 * @param {number} planId
 * @param {object} db - prisma o tx
 * @param {{seed?: boolean}} opts
 */
const materializeOpenInstallments = async (planId, db = prisma, opts = {}) => {
  const { seed = false } = opts;
  const parsedId = parseInt(planId);

  const plan = await db.installmentPlan.findUnique({
    where: { id: parsedId },
    include: { installments: { orderBy: { numero: 'asc' } } },
  });
  if (!plan || !plan.pagoAbierto || plan.estado !== 'ACTIVO') return { added: 0 };
  const cuotas = plan.installments;
  if (cuotas.length === 0) return { added: 0 };

  const monto = Number(plan.montoCuotaBase || 0);
  const limite = _endOfMonth(new Date()); // hasta el fin del mes actual
  const last = cuotas[cuotas.length - 1];
  let anchor = new Date(last.fechaVencimiento);
  let numero = last.numero;
  const nuevas = [];
  let guard = 0;

  const nuevaCuota = () => {
    anchor = _addMonths(anchor, 1);
    numero += 1;
    nuevas.push({
      planId: parsedId,
      numero,
      fechaVencimiento: anchor,
      monto,
      cargos: 0,
      cargosDetalle: { sellado: 0, gastoRetiro: 0, mora: 0 },
      total: monto,
      pagado: 0,
      estado: 'PENDIENTE',
    });
  };

  // 1) Una cuota por cada mes ya vencido/transcurrido más allá de la última.
  while (_addMonths(anchor, 1) <= limite && guard < 120) { nuevaCuota(); guard++; }

  // 2) Al activar: si no quedó ninguna cuota impaga, sembrar la próxima.
  const hayPendiente = cuotas.some(c => c.estado === 'PENDIENTE' || c.estado === 'PARCIAL') || nuevas.length > 0;
  if (seed && !hayPendiente) nuevaCuota();

  if (nuevas.length === 0) return { added: 0 };

  await db.installment.createMany({ data: nuevas });
  await db.installmentPlan.update({
    where: { id: parsedId },
    data: { totalCuotas: plan.totalCuotas + nuevas.length },
  });
  return { added: nuevas.length };
};

/**
 * Habilita el "pago abierto" para un plan que alcanzó la cuota objetivo.
 * El operador elige que el cliente siga pagando en vez de negociar. La negociación
 * sigue disponible para más adelante.
 */
const habilitarPagoAbierto = async (planId) => {
  const parsedId = parseInt(planId);
  const plan = await prisma.installmentPlan.findUnique({
    where: { id: parsedId },
    include: { installments: true },
  });
  if (!plan) throw new Error('PLAN_NOT_FOUND');
  if (plan.estado !== 'ACTIVO') throw new Error('PLAN_NOT_ACTIVE');

  const objetivo = evaluarObjetivo(plan, plan.installments);
  if (!objetivo.tieneObjetivo || !objetivo.objetivoCumplido) {
    throw new Error('INSUFFICIENT_INSTALLMENTS_PAID');
  }

  if (!plan.pagoAbierto) {
    await prisma.installmentPlan.update({ where: { id: parsedId }, data: { pagoAbierto: true } });
  }
  await materializeOpenInstallments(parsedId, prisma, { seed: true });

  return prisma.installmentPlan.findUnique({
    where: { id: parsedId },
    include: { installments: { orderBy: { numero: 'asc' } } },
  });
};

// ============================================================
// HISTORIAL DEL PLAN — ajustes, anulaciones, entregas de capital y negociación
// ============================================================
// No existe un sistema central de auditoría: el historial se arma desde los
// propios registros (que guardan quién y cuándo). Nada se reescribe.

const entregaToEvento = (e) => ({
  tipo: 'ENTREGA_CAPITAL',
  fecha: e.createdAt,
  usuario: e.createdBy,
  entregaId: e.id,
  tipoEntrega: e.tipoEntrega,
  montoDinero: e.montoDinero,
  vehiculo: e.tipoEntrega === 'DINERO' ? null : {
    valorToma: e.vehiculoValorToma, patente: e.vehiculoPatente, anio: e.vehiculoAnio,
    marca: e.vehiculoMarca, modelo: e.vehiculoModelo, observaciones: e.vehiculoObservaciones,
  },
  valorTotal: e.valorTotal,
  impactoCaja: e.montoDinero,
  observacion: e.observacion,
  legacy: false,
});

const getHistorial = async (planId) => {
  const parsedPlanId = parseInt(planId);
  const plan = await prisma.installmentPlan.findUnique({
    where: { id: parsedPlanId },
    include: {
      ajustes: { include: { installment: { select: { numero: true } } } },
      entregasCapital: true,
    },
  });
  if (!plan) throw new Error('PLAN_NOT_FOUND');

  const eventos = [];

  for (const a of plan.ajustes) {
    eventos.push({
      tipo: 'AJUSTE_OBJETIVO',
      fecha: a.createdAt,
      usuario: a.createdBy,
      ajusteId: a.id,
      tipoAjuste: a.tipo,
      monto: a.monto,
      motivo: a.motivo,
      cuotaNumero: a.installment?.numero ?? null,
      estado: a.estado,
    });
    if (a.estado === 'ANULADO') {
      eventos.push({
        tipo: 'AJUSTE_ANULADO',
        fecha: a.anuladoAt,
        usuario: a.anuladoBy,
        ajusteId: a.id,
        tipoAjuste: a.tipo,
        monto: a.monto,
        motivo: a.motivoAnulacion,
        cuotaNumero: a.installment?.numero ?? null,
      });
    }
  }

  plan.entregasCapital.forEach((e) => eventos.push(entregaToEvento(e)));

  // Entregas anteriores a la modalidad: solo existe el ingreso ENTREGA_CAPITAL en
  // Caja (sin fila EntregaCapital). Se interpretan como DINERO.
  const legacyMovs = await prisma.cashMovement.findMany({
    where: { clientId: plan.clientId, category: { name: CAT.ENTREGA_CAPITAL }, entregaCapital: null },
    orderBy: { createdAt: 'asc' },
  });
  const planesDelCliente = await prisma.installmentPlan.count({ where: { clientId: plan.clientId } });
  for (const m of legacyMovs) {
    if (planesDelCliente > 1 && !String(m.description || '').includes(`plan #${parsedPlanId}`)) continue;
    eventos.push({
      tipo: 'ENTREGA_CAPITAL', fecha: m.createdAt, usuario: m.createdBy, entregaId: null,
      tipoEntrega: 'DINERO', montoDinero: m.amount, vehiculo: null, valorTotal: m.amount,
      impactoCaja: m.amount, observacion: m.description, legacy: true,
    });
  }

  if (plan.fechaResolucion) {
    eventos.push({
      tipo: 'NEGOCIACION',
      fecha: plan.fechaResolucion,
      resultadoVehiculo: plan.resultadoVehiculo,
      observacion: plan.resolucionDetalle?.observacion || null,
    });
  }

  eventos.sort((x, y) => new Date(y.fecha) - new Date(x.fecha));
  return eventos;
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
  materializeOpenInstallments,
  habilitarPagoAbierto,
  getHistorial,
  normalizarEntrega,
};
