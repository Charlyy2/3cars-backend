/**
 * Base de datos de PRUEBAS. Estos tests BORRAN datos (TRUNCATE), así que solo
 * corren contra una base aislada:
 *   - TEST_DATABASE_URL es obligatoria (nunca se usa DATABASE_URL del .env);
 *   - host local (localhost / 127.0.0.1 / ::1);
 *   - el nombre de la base debe terminar en "_test".
 * Debe cargarse ANTES de requerir cualquier servicio (fija DATABASE_URL).
 */
const assert = require('node:assert/strict');

const url = process.env.TEST_DATABASE_URL;
const abortar = (msg) => {
  console.error(`\n[tests] ABORTADO: ${msg}\n Ver tests/README.md\n`);
  process.exit(1);
};
if (!url) abortar('falta TEST_DATABASE_URL (base aislada de pruebas).');
let parsed;
try { parsed = new URL(url); } catch { abortar('TEST_DATABASE_URL inválida.'); }
if (!['localhost', '127.0.0.1', '[::1]', '::1'].includes(parsed.hostname)) abortar(`host no local (${parsed.hostname}).`);
if (!/_test$/.test(parsed.pathname.replace(/^\//, ''))) abortar('el nombre de la base debe terminar en "_test".');
process.env.DATABASE_URL = url;

// Los servicios loguean mucho por consola (pagos); silenciar salvo TEST_VERBOSE=1.
if (!process.env.TEST_VERBOSE) console.log = () => {};

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const { CASH_CATEGORIES } = require('../../src/constants/cashCategories');
const H = require('../../src/helpers/objetivoHelper');

const EPS = 0.005;
const near = (a, b, msg) => assert.ok(Math.abs(Number(a) - Number(b)) <= EPS, `${msg}: esperado ${b}, obtenido ${a}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Vacía las tablas de negocio y asegura las categorías de Caja del sistema. */
const resetDb = async () => {
  await prisma.$executeRawUnsafe(`TRUNCATE plan_modificaciones_cuota, plan_ajustes, entregas_capital,
    cash_movements, payment_allocations, payment_attachments, payments, saldo_cuotas, installments,
    financing, customer_balances, installment_plans, audios, vehicles, clients RESTART IDENTITY CASCADE`);
  for (const c of CASH_CATEGORIES) {
    await prisma.cashMovementCategory.upsert({
      where: { name: c.name },
      update: {},
      create: { name: c.name, type: c.type, system: c.system, isManual: c.isManual, requiresClient: c.requiresClient },
    });
  }
};

/**
 * Fecha de inicio para que las cuotas 1..n ya estén vencidas (la n venció hace
 * ~8 días) y la n+1 todavía no. Relativa a hoy: los tests no envejecen.
 */
const inicioConVencidas = (n) => {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() - 8);
  d.setMonth(d.getMonth() - n);
  return d;
};

const cajaSaldo = async () => {
  const movs = await prisma.cashMovement.findMany({ include: { category: true } });
  return H.roundCurrency(movs.reduce((s, m) => s + (m.category.type === 'INGRESO' ? m.amount : -m.amount), 0));
};

/** Todo lo que una modificación de cuotas NO debe tocar. */
const snapshotDinero = async () => ({
  payments: await prisma.payment.findMany({ orderBy: { id: 'asc' } }),
  allocations: await prisma.paymentAllocation.findMany({ orderBy: { id: 'asc' } }),
  cash: await prisma.cashMovement.findMany({ orderBy: { id: 'asc' },
    select: { id: true, categoryId: true, amount: true, installmentId: true, paymentId: true } }),
  ajustes: await prisma.planAjuste.findMany({ orderBy: { id: 'asc' } }),
  balances: await prisma.customerBalance.findMany({ orderBy: { id: 'asc' } }),
  caja: await cajaSaldo(),
});

const assertDineroIntacto = (antes, despues, ctx) => {
  assert.deepEqual(despues.payments, antes.payments, `${ctx}: Payments modificados`);
  assert.deepEqual(despues.allocations, antes.allocations, `${ctx}: PaymentAllocations modificadas`);
  assert.deepEqual(despues.cash, antes.cash, `${ctx}: movimientos de Caja modificados/creados`);
  assert.deepEqual(despues.ajustes, antes.ajustes, `${ctx}: ajustes modificados`);
  assert.deepEqual(despues.balances, antes.balances, `${ctx}: saldos a favor modificados`);
  assert.equal(despues.caja, antes.caja, `${ctx}: saldo de Caja cambió`);
};

/**
 * Invariantes de consistencia sobre TODAS las cuotas de la base:
 * pagado = Σ imputaciones ≤ total; ajustado = Σ ajustes activos; estado coherente;
 * total = base + cargos; Caja por cuota = composición (cuota / sellado / retiro).
 */
const assertInvariantes = async (ctx) => {
  const cats = Object.fromEntries((await prisma.cashMovementCategory.findMany()).map((c) => [c.id, c.name]));
  const cuotas = await prisma.installment.findMany({ include: { allocations: true, ajustes: true, cashMovements: true } });
  for (const c of cuotas) {
    const tag = `${ctx} cuota#${c.id}(n${c.numero})`;
    near(c.pagado, c.allocations.reduce((s, a) => s + a.monto, 0), `${tag} pagado vs imputaciones`);
    assert.ok(c.pagado <= c.total + EPS, `${tag} sobreimputada: pagado ${c.pagado} > total ${c.total}`);
    near(c.ajustado, c.ajustes.filter((a) => a.estado === 'ACTIVO').reduce((s, a) => s + a.monto, 0), `${tag} ajustado`);
    assert.equal(c.estado, H.estadoCuota(c), `${tag} estado inconsistente`);
    const d = c.cargosDetalle || {};
    near(c.total, c.monto + (d.sellado || 0) + (d.gastoRetiro || 0) + (d.mora || 0), `${tag} total vs base+cargos`);
    const comp = H.composicionCuota(c);
    const caja = (n) => c.cashMovements.filter((m) => cats[m.categoryId] === n).reduce((s, m) => s + m.amount, 0);
    near(caja('COBRO_CUOTA'), comp.cuotaCobrada, `${tag} Caja COBRO_CUOTA`);
    near(caja('SELLADO'), comp.selladoCobrado, `${tag} Caja SELLADO`);
    near(caja('GASTO_RETIRO_COBRADO'), comp.gastoRetiroCobrado, `${tag} Caja GASTO_RETIRO_COBRADO`);
    assert.equal(caja('COMISION_CUOTA'), 0, `${tag} comisión generada`);
  }
};

module.exports = {
  prisma, H, EPS, near, sleep, resetDb, inicioConVencidas, snapshotDinero, assertDineroIntacto, assertInvariantes,
};
