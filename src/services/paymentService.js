const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const { updatePlanStatusForClient } = require('./installmentService');
const cashMovementService = require('./cashMovementService');
const configService = require('./configService');

const roundCurrency = (value) => Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;

/**
 * Crea un pago y lo distribuye automáticamente entre cuotas pendientes.
 * 
 * COMPORTAMIENTO IMPORTANTE:
 * - El pago se aplica 100% a la deuda del cliente (montoAplicado = montoTotal)
 * - El admin se calcula como informativo (no reduce el monto aplicado)
 * - La distribución es secuencial por orden de cuota
 * - Comisión y sellado solo se reconocen cuando la cuota queda PAGADA
 * - Sobrepagos se distribuyen automáticamente a cuotas siguientes
 * - Excedentes finales se guardan como saldo a favor
 */
const createPayment = async (clientId, monto, administrativoPct = undefined, fecha = undefined) => {
  console.log('🔄 Iniciando creación de pago:', { clientId, monto, administrativoPct });
  
  // VALIDACIONES CRÍTICAS
  const montoTotal = roundCurrency(Number(monto));
  
  if (isNaN(montoTotal) || montoTotal <= 0) {
    throw new Error('El monto del pago debe ser mayor a 0');
  }
  
  if (montoTotal > 100000000) {
    console.warn(`⚠️ ADVERTENCIA: Pago muy alto detectado: $${montoTotal} para cliente ${clientId}`);
  }
  
  // Verificar que el cliente existe
  const client = await prisma.client.findUnique({
    where: { id: parseInt(clientId) }
  });
  
  if (!client) {
    throw new Error('Cliente no encontrado');
  }

  const activePlan = await prisma.installmentPlan.findFirst({
    where: {
      clientId: parseInt(clientId),
      estado: 'ACTIVO'
    },
    orderBy: {
      id: 'desc'
    }
  });

  const adminPct = administrativoPct !== undefined && administrativoPct !== null
    ? Number(administrativoPct)
    : Number(activePlan?.administrativoPct || 0);

  // Calcular descuento administrativo
  const montoAdmin = roundCurrency(montoTotal * (adminPct / 100));
  const montoAplicado = montoTotal;
  
  console.log('💰 Desglose de pago:', {
    montoTotal,
    montoAdmin,
    montoAplicado
  });
  
  // Config necesaria para devengar caja (fuera de la transacción: solo lectura)
  const config = await configService.getConfig();

  // ============================================================
  // TRANSACCIÓN ATÓMICA: Payment + imputación + financing + balance +
  // estado del plan + movimientos de caja. Si algo falla (incluida la
  // caja), se revierte TODO para garantizar consistencia financiera.
  // ============================================================
  const result = await prisma.$transaction(async (tx) => {
  // Crear el registro de pago
  console.log('📝 Creando Payment...');
  const payment = await tx.payment.create({
    data: {
      clientId,
      montoTotal,
      montoAplicado,
      montoAdmin,
      origen: 'CUOTA',
      ...(fecha ? { fecha: new Date(fecha) } : {})
    }
  });
  console.log('✅ Payment creado:', payment.id);

  // Obtener cuotas del cliente ordenadas por vencimiento y número.
  // Solo de planes que siguen en circuito de cobranza: una vez RESUELTO (pasó a
  // saldo), RETIRADO o CAIDO, sus cuotas dejan de ser exigibles y no admiten pago.
  console.log('🔍 Buscando cuotas del cliente...');
  const installments = await tx.installment.findMany({
    where: {
      plan: {
        clientId: parseInt(clientId),
        estado: { in: ['ACTIVO', 'NEGOCIACION'] }
      },
      estado: {
        in: ['PENDIENTE', 'PARCIAL']
      }
    },
    include: {
      plan: true
    },
    orderBy: [
      { fechaVencimiento: 'asc' },
      { numero: 'asc' }
    ]
  });

  // Si el plan ya no está en circuito (resuelto/caído), no hay cuotas a pagar.
  if (installments.length === 0) {
    throw new Error('SIN_CUOTAS_EXIGIBLES');
  }
  console.log('📊 Cuotas encontradas:', installments.length);

  // Procesar imputación del pago (usar monto aplicado, no total)
  let remainingAmount = montoAplicado;
  const updatedInstallments = [];
  const allocations = [];
  const affectedInstallments = []; // cuotas tocadas en este pago (para devengar caja)

  for (const installment of installments) {
    if (remainingAmount <= 0) break;

    // Usar total en lugar de monto para la imputación
    const debtRemaining = roundCurrency(installment.total - installment.pagado);
    
    if (debtRemaining > 0) {
      const amountToApply = Math.min(remainingAmount, debtRemaining);
      const newPagado = roundCurrency(installment.pagado + amountToApply);
      const newEstado = newPagado >= roundCurrency(installment.total) ? 'PAGADO' : 'PARCIAL';
      
      console.log(`💰 Aplicando a cuota #${installment.numero}:`, {
        cuotaId: installment.id,
        total: installment.total,
        pagadoAntes: installment.pagado,
        aplicando: amountToApply,
        pagadoDespues: newPagado,
        restante: roundCurrency(installment.total - newPagado),
        estadoAntes: installment.estado,
        estadoDespues: newEstado
      });
      
      // Validar que no quede negativo
      if (newPagado > installment.total) {
        console.warn(`⚠️ ADVERTENCIA: Cuota ${installment.id} pagado (${newPagado}) > total (${installment.total})`);
      }
      
      // Actualizar cuota
      const updatedInstallment = await tx.installment.update({
        where: { id: installment.id },
        data: {
          pagado: newPagado,
          estado: newEstado
        }
      });

      // Crear PaymentAllocation
      console.log('📋 Creando PaymentAllocation...');
      const allocation = await tx.paymentAllocation.create({
        data: {
          paymentId: payment.id,
          installmentId: installment.id,
          monto: amountToApply
        }
      });
      console.log('✅ Allocation creada:', allocation.id);

      updatedInstallments.push({
        installmentId: installment.id,
        amountApplied: amountToApply,
        newPagado: newPagado,
        newEstado: updatedInstallment.estado
      });

      // Devengamiento de caja por CADA pago (parcial o total):
      //  - ingreso de cobro prorrateado a lo aplicado en este pago
      //  - al quedar PAGADA, además los conceptos no-base (sellado, comisión, retiro)
      affectedInstallments.push({
        installment,
        amountApplied: amountToApply,
        pagadoAntes: installment.pagado,
        newPagado,
        quedaPagada: newEstado === 'PAGADO' && installment.estado !== 'PAGADO',
      });

      allocations.push(allocation);
      remainingAmount = roundCurrency(remainingAmount - amountToApply);
    }
  }

  // Aplicar a financing si existe y hay saldo restante
  if (remainingAmount > 0) {
    console.log('🏦 Buscando financing para aplicar saldo restante...');
    const financing = await tx.financing.findFirst({
      where: { clientId: parseInt(clientId) }
    });

    if (financing && financing.saldo > 0) {
      const amountToApplyToFinancing = Math.min(remainingAmount, financing.saldo);

      console.log(`💰 Aplicando ${amountToApplyToFinancing} a financing`);

      await tx.financing.update({
        where: { id: financing.id },
        data: {
          saldo: roundCurrency(financing.saldo - amountToApplyToFinancing)
        }
      });

      remainingAmount = roundCurrency(remainingAmount - amountToApplyToFinancing);
    }
  }

  // Guardar saldo a favor si aún queda dinero
  if (remainingAmount > 0) {
    console.log(`💳 Guardando saldo a favor: ${remainingAmount}`);
    
    await tx.customerBalance.upsert({
      where: { clientId: parseInt(clientId) },
      update: {
        saldo: {
          increment: remainingAmount
        }
      },
      create: {
        clientId: parseInt(clientId),
        saldo: remainingAmount
      }
    });
  }

  console.log('📊 Imputación completada:', {
    paymentId: payment.id,
    montoTotal,
    montoAplicado,
    montoAdmin,
    cuotasAfectadas: updatedInstallments.length,
    cuotasPagadas: affectedInstallments.filter(a => a.quedaPagada).length,
    sobrante: remainingAmount,
  });

  // Recalcular estado del plan DENTRO de la transacción (usa el mismo tx)
  await updatePlanStatusForClient(clientId, tx);

  // Generar movimientos de caja por cada cuota tocada en este pago, dentro de la
  // misma transacción. Devenga el cobro prorrateado a lo aplicado, y al quedar
  // PAGADA agrega los conceptos no-base (sellado, comisión, retiro). Si esto falla,
  // la transacción entera se revierte (consistencia financiera garantizada).
  for (const af of affectedInstallments) {
    await cashMovementService.recordInstallmentPayment(
      af,
      { clientId, paymentId: payment.id, config },
      tx
    );
  }

    return {
      payment,
      allocations,
      imputationDetails: updatedInstallments,
      remainingAmount,
      saldoAFavor: remainingAmount > 0 ? remainingAmount : 0
    };
  }); // fin prisma.$transaction

  console.log('✅ Pago creado exitosamente (transacción confirmada):', result.payment.id);
  return result;
};

const getPaymentsByClientId = async (clientId) => {
  return await prisma.payment.findMany({
    where: {
      clientId: parseInt(clientId)
    },
    include: {
      client: {
        select: {
          id: true,
          nombre: true
        }
      }
    },
    orderBy: {
      fecha: 'desc'
    }
  });
};

const getAllPayments = async (filters = {}, pagination = { page: 1, length: 50 }) => {
  const { page = 1, length = 50 } = pagination;
  const { nombre, dni, cuota, fechaDesde, fechaHasta } = filters;
  
  // Build where clause for payment date (DB-level filter)
  const where = {};
  
  if (fechaDesde || fechaHasta) {
    where.fecha = {};
    // Parsear "YYYY-MM-DD" como día LOCAL (no UTC) para no correr el rango por zona horaria.
    if (fechaDesde) {
      const [y, m, d] = String(fechaDesde).slice(0, 10).split('-').map(Number);
      where.fecha.gte = new Date(y, (m || 1) - 1, d || 1, 0, 0, 0, 0);
    }
    if (fechaHasta) {
      const [y, m, d] = String(fechaHasta).slice(0, 10).split('-').map(Number);
      where.fecha.lte = new Date(y, (m || 1) - 1, d || 1, 23, 59, 59, 999);
    }
  }
  
  // Get payments with includes
  let payments = await prisma.payment.findMany({
    where,
    include: {
      client: {
        select: {
          id: true,
          nombre: true,
          dni: true
        }
      },
      allocations: {
        include: {
          installment: {
            select: {
              numero: true,
              fechaVencimiento: true
            }
          }
        }
      }
    },
    orderBy: {
      fecha: 'desc'
    }
  });
  
  // Apply JS filters (safer than Prisma relation filters)
  if (nombre) {
    const nombreLower = nombre.toLowerCase();
    payments = payments.filter(p => 
      p.client?.nombre?.toLowerCase().includes(nombreLower)
    );
  }
  
  if (dni) {
    const dniLower = dni.toLowerCase();
    payments = payments.filter(p => 
      p.client?.dni?.toLowerCase().includes(dniLower)
    );
  }
  
  if (cuota) {
    const cuotaNum = parseInt(cuota);
    if (!isNaN(cuotaNum)) {
      payments = payments.filter(p => 
        p.allocations?.some(a => a.installment?.numero === cuotaNum)
      );
    }
  }
  
  // Calculate pagination
  const total = payments.length;
  const totalPages = Math.ceil(total / length);
  const startIndex = (page - 1) * length;
  const endIndex = startIndex + length;
  const paginatedData = payments.slice(startIndex, endIndex);
  
  return {
    count: total,
    page,
    pages: totalPages,
    data: paginatedData
  };
};

const getMonthlySummary = async (month) => {
  const where = {};

  if (month) {
    const [year, monthNumber] = month.split('-').map(Number);
    const from = new Date(Date.UTC(year, monthNumber - 1, 1, 0, 0, 0));
    const to = new Date(Date.UTC(year, monthNumber, 1, 0, 0, 0));

    where.fecha = {
      gte: from,
      lt: to,
    };
  }

  const payments = await prisma.payment.findMany({
    where,
    select: {
      montoTotal: true,
      fecha: true,
    },
    orderBy: {
      fecha: 'asc',
    },
  });

  const summaryMap = new Map();

  for (const payment of payments) {
    const date = new Date(payment.fecha);
    const mes = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;

    const current = summaryMap.get(mes) || 0;
    summaryMap.set(mes, current + payment.montoTotal);
  }

  return Array.from(summaryMap.entries()).map(([mes, total]) => ({
    mes,
    total,
  }));
};

/**
 * Pago de SALDO. Imputa a las cuotas de saldo (SaldoCuota) pendientes, en orden.
 * No devenga comisión ni sellado (el saldo es otra instancia). Genera un ingreso
 * de caja COBRO_CUOTA por lo efectivamente imputado. Todo atómico.
 *
 * @param {number} clientId
 * @param {number} monto
 * @param {object} opts - { fecha, createdBy }
 */
const { CAT } = require('../constants/cashCategories');

const createSaldoPayment = async (clientId, monto, opts = {}) => {
  const { fecha, createdBy } = opts;
  const montoTotal = roundCurrency(Number(monto));
  if (isNaN(montoTotal) || montoTotal <= 0) throw new Error('El monto del pago debe ser mayor a 0');

  const parsedClientId = parseInt(clientId);
  const client = await prisma.client.findUnique({ where: { id: parsedClientId } });
  if (!client) throw new Error('Cliente no encontrado');

  // Cuotas de saldo pendientes, ordenadas
  const saldoCuotas = await prisma.saldoCuota.findMany({
    where: { clientId: parsedClientId, estado: { in: ['PENDIENTE', 'PARCIAL'] } },
    orderBy: [{ fechaVencimiento: 'asc' }, { numero: 'asc' }],
  });
  if (saldoCuotas.length === 0) throw new Error('SALDO_SIN_CUOTAS_PENDIENTES');

  return prisma.$transaction(async (tx) => {
    const payment = await tx.payment.create({
      data: {
        clientId: parsedClientId,
        montoTotal,
        montoAplicado: montoTotal,
        montoAdmin: 0,
        origen: 'SALDO',
        ...(fecha ? { fecha: new Date(fecha) } : {}),
      },
    });

    let remaining = montoTotal;
    const allocations = [];
    let aplicadoTotal = 0;

    for (const cuota of saldoCuotas) {
      if (remaining <= 0) break;
      const debt = roundCurrency(cuota.monto - cuota.pagado);
      if (debt <= 0) continue;
      const apply = Math.min(remaining, debt);
      const newPagado = roundCurrency(cuota.pagado + apply);
      const newEstado = newPagado >= roundCurrency(cuota.monto) ? 'PAGADO' : 'PARCIAL';

      await tx.saldoCuota.update({
        where: { id: cuota.id },
        data: { pagado: newPagado, estado: newEstado },
      });
      const alloc = await tx.paymentAllocation.create({
        data: { paymentId: payment.id, saldoCuotaId: cuota.id, monto: apply },
      });
      allocations.push(alloc);
      aplicadoTotal = roundCurrency(aplicadoTotal + apply);
      remaining = roundCurrency(remaining - apply);
    }

    // Ingreso de caja por lo cobrado de saldo
    if (aplicadoTotal > 0) {
      await cashMovementService.recordResolutionMovement(
        {
          categoryName: CAT.COBRO_CUOTA,
          amount: aplicadoTotal,
          origin: cashMovementService.ORIGIN.PAYMENT,
          description: `Cobro de saldo (cliente #${parsedClientId})`,
          clientId: parsedClientId,
          createdBy,
        },
        tx
      );
    }

    return { payment, allocations, aplicado: aplicadoTotal, sobrante: remaining };
  });
};

module.exports = {
  createPayment,
  createSaldoPayment,
  getPaymentsByClientId,
  getAllPayments,
  getMonthlySummary
};
