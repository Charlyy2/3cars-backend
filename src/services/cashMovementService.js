const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const { getCommissionForInstallment } = require('../helpers/commissionHelper');
const { CAT } = require('../constants/cashCategories');

const roundCurrency = (value) =>
  Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;

// Orígenes de movimiento. Solo MANUAL es editable/eliminable.
const ORIGIN = {
  MANUAL: 'MANUAL',
  PAYMENT: 'PAYMENT',
  CAPITAL_DELIVERY: 'CAPITAL_DELIVERY',
  WITHDRAWAL: 'WITHDRAWAL',
  SYSTEM: 'SYSTEM',
};

// Cache simple nombre->categoría (incluye type, única fuente de verdad del tipo)
let _categoryCache = null;

const loadCategoryMap = async (db = prisma) => {
  const cats = await db.cashMovementCategory.findMany();
  const map = {};
  for (const c of cats) map[c.name] = c;
  _categoryCache = map;
  return map;
};

const getCategoryByName = async (name, db = prisma) => {
  if (!_categoryCache || !_categoryCache[name]) {
    await loadCategoryMap(db);
  }
  const cat = _categoryCache[name];
  if (!cat) {
    throw new Error(`CASH_CATEGORY_NOT_FOUND: ${name}`);
  }
  return cat;
};

/**
 * Inserta un movimiento de caja. No recibe `type`: el tipo lo define la categoría.
 * @param {object} db - cliente prisma o tx (para correr dentro de transacciones)
 */
const createMovementRaw = async (data, db = prisma) => {
  return db.cashMovement.create({ data });
};

// ============================================================
// GENERACIÓN AUTOMÁTICA
// ============================================================

/**
 * Devenga en caja una cuota que acaba de quedar PAGADA.
 * Descompone el total cobrado SIN doble conteo:
 *   total = monto(base) + sellado + gastoRetiro + mora
 *   - COBRO_CUOTA (INGRESO) = monto base + mora      [origin PAYMENT]
 *   - GASTO_RETIRO (INGRESO) = porción gastoRetiro    [origin WITHDRAWAL]
 *   - SELLADO (INGRESO) = porción sellado, solo si !includeSealInCommission [origin PAYMENT]
 *   - COMISION_CUOTA (EGRESO) = % según commissionRules [origin PAYMENT]
 *
 * @param {object} installment - cuota PAGADA (numero, monto, cargosDetalle)
 * @param {object} ctx - { clientId, paymentId, config, createdBy }
 * @param {object} db - cliente prisma o tx (debe usarse el tx del Payment)
 */
const recordInstallmentPaid = async (installment, ctx, db = prisma) => {
  const { clientId, paymentId, createdBy } = ctx;
  const config = ctx.config || (await db.config.findFirst({ orderBy: { id: 'asc' } }));

  const detalle = installment.cargosDetalle || {};
  const sellado = roundCurrency(detalle.sellado || 0);
  const gastoRetiro = roundCurrency(detalle.gastoRetiro || 0);
  const mora = roundCurrency(detalle.mora || 0);
  const base = roundCurrency(installment.monto || 0);

  const includeSeal = !!(config && config.includeSealInCommission);

  const movements = [];
  const baseLink = {
    clientId: clientId ? parseInt(clientId) : null,
    paymentId: paymentId || null,
    installmentId: installment.id,
    createdBy: createdBy || null,
  };

  // 1) INGRESO COBRO_CUOTA = base + mora
  const cobroCuota = roundCurrency(base + mora);
  if (cobroCuota > 0) {
    const cat = await getCategoryByName(CAT.COBRO_CUOTA, db);
    movements.push(
      await createMovementRaw(
        {
          ...baseLink,
          categoryId: cat.id,
          amount: cobroCuota,
          origin: ORIGIN.PAYMENT,
          description: `Cobro cuota #${installment.numero}${mora > 0 ? ' (incluye mora)' : ''}`,
        },
        db
      )
    );
  }

  // 2) INGRESO GASTO_RETIRO_COBRADO (porción de retiro cobrada en esta cuota)
  if (gastoRetiro > 0) {
    const cat = await getCategoryByName(CAT.GASTO_RETIRO_COBRADO, db);
    movements.push(
      await createMovementRaw(
        {
          ...baseLink,
          categoryId: cat.id,
          amount: gastoRetiro,
          origin: ORIGIN.WITHDRAWAL,
          description: `Gasto de retiro cobrado en cuota #${installment.numero}`,
        },
        db
      )
    );
  }

  // 3) Sellado: independiente si NO forma parte de la comisión; si forma parte,
  //    se suma al cobro de la cuota para no perder el dinero.
  //    El sellado solo aplica a las primeras 2 cuotas (regla de negocio fija).
  if (sellado > 0 && installment.numero <= 2) {
    if (!includeSeal) {
      const cat = await getCategoryByName(CAT.SELLADO, db);
      movements.push(
        await createMovementRaw(
          {
            ...baseLink,
            categoryId: cat.id,
            amount: sellado,
            origin: ORIGIN.PAYMENT,
            description: `Sellado cuota #${installment.numero}`,
          },
          db
        )
      );
    } else {
      const cat = await getCategoryByName(CAT.COBRO_CUOTA, db);
      movements.push(
        await createMovementRaw(
          {
            ...baseLink,
            categoryId: cat.id,
            amount: sellado,
            origin: ORIGIN.PAYMENT,
            description: `Sellado (incluido en comisión) cuota #${installment.numero}`,
          },
          db
        )
      );
    }
  }

  // 4) EGRESO COMISION_CUOTA según reglas.
  //    Base de cálculo: monto base; si includeSeal, suma el sellado.
  const comisionBase = includeSeal ? roundCurrency(base + sellado) : base;
  const pct = getCommissionForInstallment(installment.numero, config || {});
  const comision = roundCurrency(comisionBase * (pct / 100));
  if (comision > 0) {
    const cat = await getCategoryByName(CAT.COMISION_CUOTA, db);
    movements.push(
      await createMovementRaw(
        {
          ...baseLink,
          categoryId: cat.id,
          amount: comision,
          origin: ORIGIN.PAYMENT,
          description: `Comisión cuota #${installment.numero} (${pct}%)`,
        },
        db
      )
    );
  }

  return movements;
};

/**
 * Devenga en caja un PAGO sobre una cuota (parcial o total).
 *
 * Modelo:
 *  - total cuota = base + mora + sellado + gastoRetiro
 *  - "cobro base" devengable = base + mora (categoría COBRO_CUOTA)
 *  - En CADA pago se devenga COBRO_CUOTA por la porción del monto aplicado que
 *    todavía corresponde a la base+mora no devengada (la plata entra a caja al instante).
 *  - Al quedar la cuota PAGADA se devengan los conceptos no-base completos:
 *    SELLADO (ingreso), GASTO_RETIRO_COBRADO (ingreso) y COMISION_CUOTA (egreso),
 *    más el remanente de base+mora si quedara por redondeo.
 *
 * @param {object} af - { installment, amountApplied, pagadoAntes, newPagado, quedaPagada }
 * @param {object} ctx - { clientId, paymentId, config, createdBy }
 */
const recordInstallmentPayment = async (af, ctx, db = prisma) => {
  const { installment, amountApplied, pagadoAntes, quedaPagada } = af;
  const { clientId, paymentId, createdBy } = ctx;
  const config = ctx.config || (await db.config.findFirst({ orderBy: { id: 'asc' } }));

  const detalle = installment.cargosDetalle || {};
  const sellado = roundCurrency(detalle.sellado || 0);
  const gastoRetiro = roundCurrency(detalle.gastoRetiro || 0);
  const mora = roundCurrency(detalle.mora || 0);
  const base = roundCurrency(installment.monto || 0);
  const includeSeal = !!(config && config.includeSealInCommission);

  const movements = [];
  const baseLink = {
    clientId: clientId ? parseInt(clientId) : null,
    paymentId: paymentId || null,
    installmentId: installment.id,
    createdBy: createdBy || null,
  };

  // Tope de cobro base+mora a devengar a lo largo de toda la cuota.
  const cobroBaseTope = roundCurrency(base + mora);
  // Cuánto del cobro base ya se devengó antes de este pago (= min(pagadoAntes, tope)).
  const cobroBasePrevio = roundCurrency(Math.min(roundCurrency(pagadoAntes || 0), cobroBaseTope));
  // Cuánto del cobro base puedo devengar con el monto aplicado en ESTE pago.
  const cobroBaseRestante = roundCurrency(cobroBaseTope - cobroBasePrevio);
  const cobroAhora = roundCurrency(Math.min(roundCurrency(amountApplied || 0), Math.max(cobroBaseRestante, 0)));

  if (cobroAhora > 0) {
    const cat = await getCategoryByName(CAT.COBRO_CUOTA, db);
    movements.push(await createMovementRaw({
      ...baseLink, categoryId: cat.id, amount: cobroAhora, origin: ORIGIN.PAYMENT,
      description: `Cobro cuota #${installment.numero}${mora > 0 ? ' (incluye mora)' : ''}${quedaPagada ? '' : ' (parcial)'}`,
    }, db));
  }

  // Conceptos no-base: SOLO al quedar la cuota completamente PAGADA.
  if (quedaPagada) {
    // Sellado (solo cuotas 1-2). Si va incluido en comisión, suma al cobro; si no, categoría propia.
    if (sellado > 0 && installment.numero <= 2) {
      if (!includeSeal) {
        const cat = await getCategoryByName(CAT.SELLADO, db);
        movements.push(await createMovementRaw({
          ...baseLink, categoryId: cat.id, amount: sellado, origin: ORIGIN.PAYMENT,
          description: `Sellado cuota #${installment.numero}`,
        }, db));
      } else {
        const cat = await getCategoryByName(CAT.COBRO_CUOTA, db);
        movements.push(await createMovementRaw({
          ...baseLink, categoryId: cat.id, amount: sellado, origin: ORIGIN.PAYMENT,
          description: `Sellado (incluido en comisión) cuota #${installment.numero}`,
        }, db));
      }
    }

    // Gasto de retiro cobrado
    if (gastoRetiro > 0) {
      const cat = await getCategoryByName(CAT.GASTO_RETIRO_COBRADO, db);
      movements.push(await createMovementRaw({
        ...baseLink, categoryId: cat.id, amount: gastoRetiro, origin: ORIGIN.WITHDRAWAL,
        description: `Gasto de retiro cobrado en cuota #${installment.numero}`,
      }, db));
    }

    // Comisión (egreso) según reglas. Base: monto base; si includeSeal, suma el sellado.
    const comisionBase = includeSeal ? roundCurrency(base + sellado) : base;
    const pct = getCommissionForInstallment(installment.numero, config || {});
    const comision = roundCurrency(comisionBase * (pct / 100));
    if (comision > 0) {
      const cat = await getCategoryByName(CAT.COMISION_CUOTA, db);
      movements.push(await createMovementRaw({
        ...baseLink, categoryId: cat.id, amount: comision, origin: ORIGIN.PAYMENT,
        description: `Comisión cuota #${installment.numero} (${pct}%)`,
      }, db));
    }
  }

  return movements;
};

/**
 * Helper interno: crea un movimiento ligado a la resolución de un plan.
 * Solo crea si amount > 0 (devuelve null en caso contrario).
 */
const recordResolutionMovement = async (
  { categoryName, amount, origin, description, clientId, createdBy },
  db = prisma
) => {
  const value = roundCurrency(amount);
  if (!(value > 0)) return null;
  const cat = await getCategoryByName(categoryName, db);
  return createMovementRaw(
    {
      categoryId: cat.id,
      amount: value,
      origin: origin || ORIGIN.SYSTEM,
      description: description || null,
      clientId: clientId ? parseInt(clientId) : null,
      paymentId: null,
      installmentId: null,
      createdBy: createdBy || null,
    },
    db
  );
};

/**
 * Registra una entrega de capital (resolución de plan).
 */
const recordCapitalDelivery = async (
  { clientId, planId, amount, description, createdBy },
  db = prisma
) =>
  recordResolutionMovement(
    {
      categoryName: CAT.ENTREGA_CAPITAL,
      amount,
      origin: ORIGIN.CAPITAL_DELIVERY,
      description: description || `Entrega de capital (plan #${planId})`,
      clientId,
      createdBy,
    },
    db
  );

// ============================================================
// CRUD MANUAL + CONSULTAS
// ============================================================

// El tipo se filtra a través de la relación con la categoría (única fuente de verdad).
const buildWhere = (filters = {}) => {
  const { type, categoryId, clientId, fechaDesde, fechaHasta } = filters;
  const where = {};
  if (type) where.category = { type };
  if (categoryId) where.categoryId = parseInt(categoryId);
  if (clientId) where.clientId = parseInt(clientId);
  if (fechaDesde || fechaHasta) {
    where.createdAt = {};
    // Parsear "YYYY-MM-DD" como día LOCAL (no UTC) para no correr el rango por zona horaria.
    if (fechaDesde) where.createdAt.gte = parseDayStart(fechaDesde);
    if (fechaHasta) where.createdAt.lte = parseDayEnd(fechaHasta);
  }
  return where;
};

// "YYYY-MM-DD" -> Date al inicio del día en hora local del servidor.
const parseDayStart = (s) => {
  const [y, m, d] = String(s).slice(0, 10).split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1, 0, 0, 0, 0);
};
// "YYYY-MM-DD" -> Date al final del día en hora local del servidor.
const parseDayEnd = (s) => {
  const [y, m, d] = String(s).slice(0, 10).split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1, 23, 59, 59, 999);
};

const getMovements = async (filters = {}) => {
  const where = buildWhere(filters);
  const movements = await prisma.cashMovement.findMany({
    where,
    include: {
      category: true,
      client: { select: { id: true, nombre: true, apellido: true, dni: true } },
    },
    orderBy: { createdAt: 'desc' },
  });
  // Exponer `type` derivado de la categoría para comodidad del front
  return movements.map((m) => ({ ...m, type: m.category?.type }));
};

const getSummary = async (filters = {}) => {
  const where = buildWhere(filters);
  const movements = await prisma.cashMovement.findMany({
    where,
    select: { amount: true, category: { select: { type: true } } },
  });

  let ingresos = 0;
  let egresos = 0;
  for (const m of movements) {
    if (m.category?.type === 'INGRESO') ingresos += m.amount;
    else if (m.category?.type === 'EGRESO') egresos += m.amount;
  }
  ingresos = roundCurrency(ingresos);
  egresos = roundCurrency(egresos);
  return { ingresos, egresos, balance: roundCurrency(ingresos - egresos) };
};

const createManualMovement = async ({ categoryId, amount, description, clientId, createdBy }) => {
  const parsedAmount = roundCurrency(amount);
  if (isNaN(parsedAmount) || parsedAmount <= 0) {
    throw new Error('INVALID_AMOUNT');
  }
  const category = await prisma.cashMovementCategory.findUnique({
    where: { id: parseInt(categoryId) },
  });
  if (!category) throw new Error('CATEGORY_NOT_FOUND');
  // No se permite crear manualmente categorías automáticas del sistema.
  if (category.isManual === false) throw new Error('CATEGORY_NOT_MANUAL');
  // Si la categoría requiere cliente, debe venir uno.
  if (category.requiresClient && !clientId) throw new Error('CATEGORY_REQUIRES_CLIENT');

  const movement = await prisma.cashMovement.create({
    data: {
      categoryId: parseInt(categoryId),
      amount: parsedAmount,
      description: description || null,
      clientId: clientId ? parseInt(clientId) : null,
      origin: ORIGIN.MANUAL,
      createdBy: createdBy || null,
    },
    include: { category: true },
  });
  return { ...movement, type: movement.category?.type };
};

const updateManualMovement = async (id, { categoryId, amount, description, clientId }) => {
  const movement = await prisma.cashMovement.findUnique({
    where: { id: parseInt(id) },
    include: { category: true },
  });
  if (!movement) throw new Error('MOVEMENT_NOT_FOUND');
  if (movement.origin !== ORIGIN.MANUAL) throw new Error('NOT_MANUAL');

  const data = {};
  if (categoryId !== undefined) {
    const category = await prisma.cashMovementCategory.findUnique({
      where: { id: parseInt(categoryId) },
    });
    if (!category) throw new Error('CATEGORY_NOT_FOUND');
    // Solo se permite cambiar a una categoría del mismo tipo (INGRESO/EGRESO)
    if (category.type !== movement.category.type) throw new Error('CATEGORY_TYPE_MISMATCH');
    data.categoryId = parseInt(categoryId);
  }
  if (amount !== undefined) {
    const parsedAmount = roundCurrency(amount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) throw new Error('INVALID_AMOUNT');
    data.amount = parsedAmount;
  }
  if (description !== undefined) data.description = description;
  if (clientId !== undefined) data.clientId = clientId ? parseInt(clientId) : null;

  const updated = await prisma.cashMovement.update({
    where: { id: parseInt(id) },
    data,
    include: { category: true },
  });
  return { ...updated, type: updated.category?.type };
};

const deleteManualMovement = async (id) => {
  const movement = await prisma.cashMovement.findUnique({ where: { id: parseInt(id) } });
  if (!movement) throw new Error('MOVEMENT_NOT_FOUND');
  if (movement.origin !== ORIGIN.MANUAL) throw new Error('NOT_MANUAL');
  return prisma.cashMovement.delete({ where: { id: parseInt(id) } });
};

const getCategories = async (filters = {}) => {
  const where = {};
  if (filters.type) where.type = filters.type;
  if (filters.isManual !== undefined) where.isManual = filters.isManual;
  if (filters.requiresClient !== undefined) where.requiresClient = filters.requiresClient;
  return prisma.cashMovementCategory.findMany({ where, orderBy: [{ type: 'asc' }, { name: 'asc' }] });
};

module.exports = {
  ORIGIN,
  // automáticos
  recordInstallmentPaid,
  recordInstallmentPayment,
  recordCapitalDelivery,
  recordResolutionMovement,
  // manuales / consultas
  getMovements,
  getSummary,
  createManualMovement,
  updateManualMovement,
  deleteManualMovement,
  getCategories,
};
