/**
 * Regla "un solo plan vigente (ACTIVO / NEGOCIACION) por cliente" bajo concurrencia:
 * crear plan, reactivar plan y la ruta heredada POST /installments/plans.
 * Base AISLADA (ver tests/README.md).
 */
const { test, before, after, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { prisma, sleep, resetDb, inicioConVencidas, assertInvariantes } = require('./helpers/testDb');

const planService = require('../src/services/planService');
const paymentService = require('../src/services/paymentService');
const installmentService = require('../src/services/installmentService');
const reactivacionService = require('../src/services/reactivacionService');
const { lockClient } = require('../src/helpers/lockHelper');

const USER = { id: 1, username: 'gustavo' };
let seq = 0;
const nuevoCliente = () => prisma.client.create({ data: { nombre: `Vigente ${++seq}` } });
const crearPlan = (clientId, vencidas = 1) => planService.createPlan({
  clientId, montoCuotaBase: 300000, cantidadCuotas: 10, fechaInicio: inicioConVencidas(vencidas),
  selladoMonto: 0, cuotasConSellado: 2, cuotaObjetivoRetiro: 0, primerCuotaPagada: false,
});
const vigentes = (clientId) => prisma.installmentPlan.count({ where: { clientId, estado: { in: ['ACTIVO', 'NEGOCIACION'] } } });
const resultado = (p) => p.then(() => 'OK', (e) => e.message);

/** Cliente con un plan CAIDO por mora que ya cumple la condición para reactivarse. */
const clienteConCaidoReactivable = async () => {
  const c = await nuevoCliente();
  const { plan } = await crearPlan(c.id, 5);
  await paymentService.createPayment(c.id, 300000); // cae (4 vencidas)
  await paymentService.createPayment(c.id, 600000, undefined, undefined, { planId: plan.id }); // quedan 2
  assert.equal((await prisma.installmentPlan.findUnique({ where: { id: plan.id } })).estado, 'CAIDO');
  return { clientId: c.id, planId: plan.id };
};

before(resetDb);
after(() => prisma.$disconnect());
afterEach(async (t) => { await assertInvariantes(t.name); });

test('Crear plan: rechaza si ya hay uno ACTIVO o en NEGOCIACION; permite si solo hay CAIDO / RESUELTO', async () => {
  const c = await nuevoCliente();
  const { plan } = await crearPlan(c.id);
  await assert.rejects(() => crearPlan(c.id), { message: 'ACTIVE_PLAN_EXISTS' });
  await prisma.installmentPlan.update({ where: { id: plan.id }, data: { estado: 'NEGOCIACION' } });
  await assert.rejects(() => crearPlan(c.id), { message: 'ACTIVE_PLAN_EXISTS' });
  for (const estado of ['CAIDO', 'RESUELTO']) {
    await prisma.installmentPlan.updateMany({ where: { clientId: c.id }, data: { estado } });
    await crearPlan(c.id); // permitido
    assert.equal(await vigentes(c.id), 1);
  }
});

test('Ruta heredada POST /installments/plans respeta la misma regla', async () => {
  const c = await nuevoCliente();
  await crearPlan(c.id);
  await assert.rejects(() => installmentService.createInstallmentPlan(c.id, 3, 1000, new Date().toISOString()), { message: 'ACTIVE_PLAN_EXISTS' });
  assert.equal(await vigentes(c.id), 1);
});

test('Crear plan espera el lock del cliente y revalida', async () => {
  const c = await nuevoCliente();
  const t0 = Date.now();
  // Otra operación tiene el lock del cliente y deja un plan vigente antes de soltarlo.
  const otra = prisma.$transaction(async (tx) => {
    await lockClient(tx, c.id);
    await tx.installmentPlan.create({ data: { clientId: c.id, totalCuotas: 1, montoCuotaBase: 1, fechaInicio: new Date(), estado: 'ACTIVO' } });
    await sleep(1500);
  }, { timeout: 10000 });
  await sleep(100);
  const [, r] = await Promise.all([otra, resultado(crearPlan(c.id))]);
  assert.ok(Date.now() - t0 >= 1400, 'no esperó el lock del cliente');
  assert.equal(r, 'ACTIVE_PLAN_EXISTS');
  assert.equal(await vigentes(c.id), 1);
});

test('Dos creaciones simultáneas del mismo cliente: una sola prospera (20 rondas)', async () => {
  for (let i = 0; i < 20; i++) {
    const c = await nuevoCliente();
    const rs = await Promise.all([resultado(crearPlan(c.id)), resultado(crearPlan(c.id))]);
    assert.deepEqual(rs.sort(), ['ACTIVE_PLAN_EXISTS', 'OK']);
    assert.equal(await vigentes(c.id), 1);
  }
});

test('Crear y reactivar simultáneamente: nunca quedan dos planes vigentes (20 rondas)', async () => {
  const conteo = { creo: 0, reactivo: 0 };
  for (let i = 0; i < 20; i++) {
    const { clientId, planId } = await clienteConCaidoReactivable();
    const prev = await reactivacionService.previsualizar(planId);
    const [rc, rr] = await Promise.all([
      resultado(crearPlan(clientId)),
      sleep(Math.floor(Math.random() * 40)).then(() => resultado(reactivacionService.reactivarPlan(planId, {
        motivo: 'race', user: USER, versionVistaPrevia: prev.versionVistaPrevia,
      }))),
    ]);
    assert.equal(await vigentes(clientId), 1, `ronda ${i}: ${rc} / ${rr}`);
    if (rr === 'OK') {
      conteo.reactivo++;
      assert.equal(rc, 'ACTIVE_PLAN_EXISTS');
    } else {
      conteo.creo++;
      assert.equal(rc, 'OK');
      // Al confirmar ve el plan nuevo: o cambió la huella (otro plan vigente) o lo bloquea la regla.
      assert.ok(['VISTA_PREVIA_DESACTUALIZADA', 'OTRO_PLAN_VIGENTE'].includes(rr), rr);
      assert.equal((await prisma.installmentPlan.findUnique({ where: { id: planId } })).estado, 'CAIDO');
    }
  }
  assert.equal(conteo.creo + conteo.reactivo, 20);
});

test('Sin deadlock: pago dirigido + reactivación + creación simultáneos (15 rondas)', async () => {
  for (let i = 0; i < 15; i++) {
    const { clientId, planId } = await clienteConCaidoReactivable();
    const prev = await reactivacionService.previsualizar(planId);
    const rs = await Promise.all([
      resultado(paymentService.createPayment(clientId, 10000, undefined, undefined, { planId })),
      resultado(reactivacionService.reactivarPlan(planId, { motivo: 'race', user: USER, versionVistaPrevia: prev.versionVistaPrevia })),
      resultado(crearPlan(clientId)),
    ]);
    assert.equal(rs[0], 'OK', `el pago dirigido falló: ${rs[0]}`);
    assert.ok(!rs.some((r) => /deadlock/i.test(r)), rs.join(' / '));
    assert.equal(await vigentes(clientId), 1);
  }
});
