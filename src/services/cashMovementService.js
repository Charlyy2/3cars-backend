const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const { CAT } = require('../constants/cashCategories');
const { composicionCuota } = require('../helpers/objetivoHelper');

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
 * Devenga en caja una cuota que acaba de quedar PAGADA de una sola vez (p. ej.
 * primera cuota pagada al crear el plan). Delega en recordInstallmentPayment
 * para que exista UN solo camino de devengamiento.
 *
 * @param {object} installment - cuota PAGADA (numero, monto, cargosDetalle, total)
 * @param {object} ctx - { clientId, paymentId, createdBy }
 * @param {object} db - cliente prisma o tx (debe usarse el tx del Payment)
 */
const recordInstallmentPaid = async (installment, ctx, db = prisma) =>
  recordInstallmentPayment(
    {
      installment: { ...installment, pagado: 0, ajustado: Number(installment.ajustado || 0) },
      pagadoAntes: 0,
      newPagado: Number(installment.total || 0),
    },
    ctx,
    db
  );

/**
 * Devenga en caja un PAGO sobre una cuota (parcial o total).
 *
 * Regla de imputación (confirmada): el dinero cubre PRIMERO el importe de la
 * cuota (base + mora) y después los cargos: sellado → gasto de retiro.
 * Cada pago registra en Caja exactamente el dinero que, por esa cascada, fue a
 * cada concepto (diferencia entre la composición antes y después del pago):
 *   - COBRO_CUOTA          ← porción de cuota (base + mora)
 *   - SELLADO              ← porción de sellado
 *   - GASTO_RETIRO_COBRADO ← porción de gasto de retiro
 * Lo ajustado/condonado (installment.ajustado) nunca entra a Caja: solo baja el
 * tope de dinero de la cuota (ver composicionCuota).
 *
 * En 3CARS NO existe comisión: nunca se genera COMISION_CUOTA (categoría solo
 * histórica). Config.commissionRules / comisionPorcentaje / includeSealInCommission
 * están deprecados y no afectan los pagos.
 *
 * @param {object} af - { installment, pagadoAntes, newPagado }
 * @param {object} ctx - { clientId, paymentId, createdBy }
 */
const recordInstallmentPayment = async (af, ctx, db = prisma) => {
  const { installment, pagadoAntes, newPagado } = af;
  const { clientId, paymentId, createdBy } = ctx;

  const detalle = installment.cargosDetalle || {};
  const sellado = roundCurrency(detalle.sellado || 0);
  const mora = roundCurrency(detalle.mora || 0);

  // Composición antes / después del pago (mismo ajustado: el pago no lo cambia).
  const antes = composicionCuota({ ...installment, pagado: pagadoAntes || 0 });
  const despues = composicionCuota({ ...installment, pagado: newPagado });
  const delta = (k) => roundCurrency(despues[k] - antes[k]);
  const cobroAhora = delta('cuotaCobrada');
  const selladoAhora = delta('selladoCobrado');
  const retiroAhora = delta('gastoRetiroCobrado');

  const movements = [];
  const baseLink = {
    clientId: clientId ? parseInt(clientId) : null,
    paymentId: paymentId || null,
    installmentId: installment.id,
    createdBy: createdBy || null,
  };

  if (cobroAhora > 0) {
    const cat = await getCategoryByName(CAT.COBRO_CUOTA, db);
    movements.push(await createMovementRaw({
      ...baseLink, categoryId: cat.id, amount: cobroAhora, origin: ORIGIN.PAYMENT,
      description: `Cobro cuota #${installment.numero}${mora > 0 ? ' (incluye mora)' : ''}${despues.cuotaPendiente > 0 ? ' (parcial)' : ''}`,
    }, db));
  }

  // Sellado efectivamente cobrado (siempre en su categoría propia).
  if (selladoAhora > 0) {
    const cat = await getCategoryByName(CAT.SELLADO, db);
    movements.push(await createMovementRaw({
      ...baseLink, categoryId: cat.id, amount: selladoAhora, origin: ORIGIN.PAYMENT,
      description: `Sellado cuota #${installment.numero}${despues.selladoCobrado < sellado ? ' (parcial)' : ''}`,
    }, db));
  }

  // Gasto de retiro efectivamente cobrado
  if (retiroAhora > 0) {
    const cat = await getCategoryByName(CAT.GASTO_RETIRO_COBRADO, db);
    movements.push(await createMovementRaw({
      ...baseLink, categoryId: cat.id, amount: retiroAhora, origin: ORIGIN.WITHDRAWAL,
      description: `Gasto de retiro cobrado en cuota #${installment.numero}${despues.gastoRetiroCobrado < despues.gastoRetiro ? ' (parcial)' : ''}`,
    }, db));
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
