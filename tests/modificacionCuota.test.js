/**
 * "Modificar valor de cuota" — pruebas de integración contra una base AISLADA.
 * Ejecutar: TEST_DATABASE_URL=postgresql://...@127.0.0.1:<port>/<db>_test npm test
 * (ver tests/README.md). Los casos corren en orden y comparten la base.
 */
const { test, before, after, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const {
  prisma, H, near, sleep, resetDb, inicioConVencidas, snapshotDinero, assertDineroIntacto, assertInvariantes,
} = require('./helpers/testDb');

const planService = require('../src/services/planService');
const paymentService = require('../src/services/paymentService');
const ajusteService = require('../src/services/ajusteObjetivoService');
const metricsService = require('../src/services/metricsService');
const clientStatusService = require('../src/services/clientStatusService');
const { updatePlanStatusForClient } = require('../src/services/installmentService');
const modService = require('../src/services/modificacionCuotaService');
const { lockPlan } = require('../src/helpers/lockHelper');

const USER = { id: 1, username: 'gustavo' };

// ---------------------------------------------------------------- helpers
let seq = 0;
/** Plan de 10 cuotas de $300.000; por defecto las cuotas 1..5 ya vencieron. */
const nuevoPlan = async (opts = {}) => {
  const client = await prisma.client.create({ data: { nombre: `Test ${++seq}` } });
  const { plan } = await planService.createPlan({
    clientId: client.id,
    montoCuotaBase: opts.monto ?? 300000,
    cantidadCuotas: opts.cuotas ?? 10,
    fechaInicio: opts.fechaInicio ?? inicioConVencidas(opts.vencidas ?? 5),
    selladoMonto: opts.sellado ?? 0,
    cuotasConSellado: opts.cuotasConSellado ?? 2,
    cuotaObjetivoRetiro: opts.objetivo ?? 0,
    primerCuotaPagada: false,
  });
  return { clientId: client.id, planId: plan.id };
};
const pagar = (clientId, monto) => paymentService.createPayment(clientId, monto);
const cuotasDe = (planId) => prisma.installment.findMany({ where: { planId }, orderBy: { numero: 'asc' } });
const planDe = (planId) => prisma.installmentPlan.findUnique({ where: { id: planId } });
const deuda = (cuotas) => H.roundCurrency(cuotas.reduce((s, c) => s + H.deudaEfectivaCuota(c), 0));

/** Flujo real de la UI: vista previa → confirmar con su versión. */
const modificar = async (planId, nuevoMonto, extra = {}) => {
  const prev = await modService.previsualizar(planId, nuevoMonto);
  return modService.modificarCuotas(planId, {
    nuevoMonto, motivo: 'motivo de prueba', user: USER, versionVistaPrevia: prev.versionVistaPrevia, ...extra,
  });
};

const expectReject = async (fn, code) => {
  try { await fn(); } catch (e) { assert.equal(e.message, code, `se esperaba ${code}, vino ${e.message}`); return e; }
  return assert.fail(`se esperaba rechazo ${code}`);
};

before(resetDb);
after(() => prisma.$disconnect());
// Después de cada caso, la base completa debe seguir siendo consistente.
afterEach(async (t) => { await assertInvariantes(t.name); });

// ---------------------------------------------------------------- casos
let planAB; // compartido A → B → F

test('A — Reducción normal: misma cantidad de cuotas, deuda -$600.000, Caja intacta (+ C vencida)', async () => {
  planAB = await nuevoPlan();
  await pagar(planAB.clientId, 1200000); // cuotas 1-4 pagadas
  const antes = await cuotasDe(planAB.planId);
  assert.equal(deuda(antes), 1800000);
  assert.ok(antes[4].fechaVencimiento < new Date(), 'la cuota 5 debe estar vencida');
  const s0 = await snapshotDinero();

  const prev = await modService.previsualizar(planAB.planId, 200000);
  assert.equal(prev.cuotasAfectadas, 6);
  near(prev.deudaActual, 1800000, 'preview deuda'); near(prev.deudaNueva, 1200000, 'preview nueva'); near(prev.variacionDeuda, -600000, 'preview var');

  const r = await modService.modificarCuotas(planAB.planId, {
    nuevoMonto: 200000, motivo: 'El cliente no puede afrontar el importe anterior.', user: USER, versionVistaPrevia: prev.versionVistaPrevia,
  });
  const despues = await cuotasDe(planAB.planId);
  assert.equal(despues.length, 10);
  for (const c of despues.slice(0, 4)) { assert.equal(c.monto, 300000); assert.equal(c.estado, 'PAGADO'); }
  for (const c of despues.slice(4)) { assert.equal(c.monto, 200000); assert.equal(c.total, 200000); assert.equal(c.estado, 'PENDIENTE'); }
  despues.forEach((c, i) => assert.equal(c.fechaVencimiento.getTime(), antes[i].fechaVencimiento.getTime(), 'vencimientos intactos'));
  near(deuda(despues), 1200000, 'deuda nueva');
  assert.equal((await planDe(planAB.planId)).montoCuotaBase, 200000);
  assertDineroIntacto(s0, await snapshotDinero(), 'A');
  assert.equal(r.modificacion.cuotasAfectadas, 6);
  assert.equal(r.modificacion.versionVistaPrevia, prev.versionVistaPrevia, 'auditoría con la versión aceptada');
  const met = await metricsService.calcularMetricasVenta(planAB.planId);
  near(met.deudaPendiente, 1200000, 'métrica deuda'); near(met.totalCobrado, 1200000, 'total cobrado intacto');
});

test('B — Aumento posterior: solo cambian las cuotas abiertas', async () => {
  await pagar(planAB.clientId, 200000); // cuota 5 pagada a $200.000
  const s0 = await snapshotDinero();
  await modificar(planAB.planId, 250000);
  const c = await cuotasDe(planAB.planId);
  assert.deepEqual(c.map((x) => x.monto), [300000, 300000, 300000, 300000, 200000, 250000, 250000, 250000, 250000, 250000]);
  assert.equal(c[4].estado, 'PAGADO');
  near(deuda(c), 1250000, 'deuda tras aumento');
  assertDineroIntacto(s0, await snapshotDinero(), 'B');
});

test('F — Historial: dos eventos distintos con la evolución completa', async () => {
  const h = (await planService.getHistorial(planAB.planId)).filter((e) => e.tipo === 'MODIFICACION_CUOTA');
  assert.equal(h.length, 2);
  const [segundo, primero] = h; // orden descendente
  assert.equal(primero.montoNuevo, 200000); assert.equal(primero.montoAnteriorPlan, 300000); near(primero.variacionDeuda, -600000, 'ev1');
  assert.equal(primero.usuario, 'gustavo'); assert.deepEqual(primero.cuotas.map((x) => x.numero), [5, 6, 7, 8, 9, 10]);
  assert.equal(segundo.montoNuevo, 250000); assert.equal(segundo.cuotasAfectadas, 5); near(segundo.variacionDeuda, 250000, 'ev2');
});

let planDE;
test('D — Parcial compatible: $300.000 con $195.000 pagado → $200.000 (pendiente $5.000)', async () => {
  planDE = await nuevoPlan();
  await pagar(planDE.clientId, 1200000 + 195000);
  const s0 = await snapshotDinero();
  await modificar(planDE.planId, 200000);
  const c5 = (await cuotasDe(planDE.planId))[4];
  assert.equal(c5.monto, 200000); assert.equal(c5.pagado, 195000); assert.equal(c5.estado, 'PARCIAL');
  near(H.deudaEfectivaCuota(c5), 5000, 'pendiente base');
  assertDineroIntacto(s0, await snapshotDinero(), 'D');
});

test('E — Parcial incompatible: $150.000 < $195.000 pagado → rechazo total', async () => {
  const c0 = await cuotasDe(planDE.planId); const s0 = await snapshotDinero();
  const h0 = await prisma.planModificacionCuota.count();
  const prev = await modService.previsualizar(planDE.planId, 150000);
  assert.equal(prev.puedeConfirmar, false);
  assert.equal(prev.incompatibles[0].numero, 5);
  assert.match(prev.incompatibles[0].motivo, /No podés establecer un importe inferior a lo que el cliente ya pagó en esta cuota \(\$195\.000\)/);
  await expectReject(() => modificar(planDE.planId, 150000), 'CUOTAS_INCOMPATIBLES');
  assert.deepEqual(await cuotasDe(planDE.planId), c0);
  assert.equal(await prisma.planModificacionCuota.count(), h0);
  assertDineroIntacto(s0, await snapshotDinero(), 'E');
});

test('G — Cuota objetivo: objetivo monetario actualizado, sin pagos ficticios, efecto en negociación confirmado', async () => {
  const p = await nuevoPlan({ objetivo: 5 });
  await pagar(p.clientId, 1200000 + 195000);
  const s0 = await snapshotDinero();
  await modificar(p.planId, 200000);
  const o1 = (await planService.getPlanById(p.planId)).objetivo;
  near(o1.objetivoOriginal, 1400000, 'objetivo'); near(o1.pagadoReal, 1395000, 'pagado real'); near(o1.saldoPendienteEfectivo, 5000, 'pend');
  assert.equal(o1.puedeNegociar, false);
  const prev = await modService.previsualizar(p.planId, 195000);
  assert.equal(prev.objetivo.efectoNegociacion, 'HABILITA');
  await expectReject(() => modificar(p.planId, 195000), 'CONFIRMACION_NEGOCIACION_REQUERIDA');
  await modificar(p.planId, 195000, { aceptaCambioNegociacion: true });
  const plan = await planService.getPlanById(p.planId);
  assert.equal(plan.cuotaObjetivoRetiro, 5);
  assert.equal(plan.objetivo.puedeNegociar, true);
  near(plan.objetivo.pagadoReal, 1395000, 'sin pago ficticio'); assert.equal(plan.objetivo.ajustesAplicados, 0);
  assertDineroIntacto(s0, await snapshotDinero(), 'G');
});

test('G2 — Cuota con ajuste previo: no se perfora lo cubierto ni se salda solo con el ajuste', async () => {
  const p = await nuevoPlan({ objetivo: 5 });
  await pagar(p.clientId, 1200000 + 100000);
  await ajusteService.crearAjuste(p.planId, { tipo: 'AJUSTE_COMERCIAL', monto: 50000, motivo: 'previo', user: USER });
  assert.match((await modService.previsualizar(p.planId, 140000)).incompatibles[0].motivo, /ajustado/);
  assert.match((await modService.previsualizar(p.planId, 150000)).incompatibles[0].motivo, /saldada solo por ajustes/);
  const s0 = await snapshotDinero();
  await modificar(p.planId, 200000);
  const c5 = (await cuotasDe(p.planId))[4];
  assert.equal(c5.ajustado, 50000); assert.equal(c5.pagado, 100000); near(H.deudaEfectivaCuota(c5), 50000, 'pend');
  assertDineroIntacto(s0, await snapshotDinero(), 'G2');
});

test('H — Cargos (sellado / gasto de retiro): solo cambia la base, sin ingresos artificiales', async () => {
  const p = await nuevoPlan({ sellado: 20000, cuotasConSellado: 2, vencidas: 1 });
  const c3 = (await cuotasDe(p.planId))[2];
  await prisma.installment.update({ where: { id: c3.id }, data: { cargosDetalle: { sellado: 0, gastoRetiro: 15000, mora: 0 }, cargos: 15000, total: 315000 } });
  await pagar(p.clientId, 310000); // cuota 1: base cubierta + $10.000 de sellado
  const s0 = await snapshotDinero();
  assert.equal((await modService.previsualizar(p.planId, 200000)).cuotas[0].categoria, 'PROTEGIDA');
  await modificar(p.planId, 200000);
  const c = await cuotasDe(p.planId);
  assert.equal(c[0].monto, 300000); assert.equal(c[0].total, 320000);
  assert.equal(c[1].monto, 200000); assert.equal(c[1].total, 220000); assert.equal(c[1].cargosDetalle.sellado, 20000);
  assert.equal(c[2].monto, 200000); assert.equal(c[2].total, 215000); assert.equal(c[2].cargosDetalle.gastoRetiro, 15000);
  assertDineroIntacto(s0, await snapshotDinero(), 'H');
  await pagar(p.clientId, 215000); // 10k sellado c1 → 200k base c2 → 5k sellado c2
  const mov = await prisma.cashMovement.findMany({ where: { installmentId: c[1].id }, include: { category: true } });
  near(mov.filter((m) => m.category.name === 'COBRO_CUOTA').reduce((s, m) => s + m.amount, 0), 200000, 'cobro c2');
  near(mov.filter((m) => m.category.name === 'SELLADO').reduce((s, m) => s + m.amount, 0), 5000, 'sellado c2');
});

// ---------------------------------------------------------------- CAIDO
test('CAÍDO — se modifican las cuotas pendientes y el plan sigue CAIDO (sin reactivación)', async () => {
  const p = await nuevoPlan(); // cuotas 1..5 vencidas
  await pagar(p.clientId, 300000); // solo cuota 1 → 4 vencidas impagas → el sistema lo marca CAIDO
  assert.equal((await planDe(p.planId)).estado, 'CAIDO');
  const antes = await cuotasDe(p.planId);
  const status0 = await clientStatusService.getClientStatus(p.clientId);
  const s0 = await snapshotDinero();

  // Por defecto un plan CAIDO no es "el plan" del cliente; el detalle lo pide explícitamente.
  assert.equal(await planService.getPlanByClientId(p.clientId), null);
  const visto = await planService.getPlanByClientId(p.clientId, { incluirCaido: true });
  assert.equal(visto.id, p.planId); assert.equal(visto.estado, 'CAIDO');

  const prev = await modService.previsualizar(p.planId, 200000);
  assert.equal(prev.planModificable, true); assert.equal(prev.planCaido, true);
  assert.equal(prev.avisoEstado, 'Se modificarán las cuotas pendientes, pero el plan continuará en estado CAÍDO.');
  assert.equal(prev.cuotasAfectadas, 9);
  const r = await modService.modificarCuotas(p.planId, { nuevoMonto: 200000, motivo: 'Recuperar al cliente', user: USER, versionVistaPrevia: prev.versionVistaPrevia });

  assert.equal((await planDe(p.planId)).estado, 'CAIDO', 'no debe reactivarse');
  const despues = await cuotasDe(p.planId);
  assert.equal(despues[0].monto, 300000);
  despues.slice(1).forEach((c) => assert.equal(c.monto, 200000));
  despues.forEach((c, i) => assert.equal(c.fechaVencimiento.getTime(), antes[i].fechaVencimiento.getTime(), 'vencimientos intactos'));
  const status1 = await clientStatusService.getClientStatus(p.clientId);
  assert.equal(status1.cuotasVencidas, status0.cuotasVencidas, 'los atrasos no se eliminan');
  assert.equal(status1.estado, 'CAIDO');
  near(r.modificacion.variacionDeuda, -900000, 'reducción 9 × $100.000');
  assertDineroIntacto(s0, await snapshotDinero(), 'CAIDO');

  // Recalcular el estado del cliente no lo reactiva, y sigue sin admitir pagos
  // hasta una reactivación explícita (comportamiento existente).
  await updatePlanStatusForClient(p.clientId);
  assert.equal((await planDe(p.planId)).estado, 'CAIDO');
  await expectReject(() => pagar(p.clientId, 1000), 'SIN_CUOTAS_EXIGIBLES');
  const h = (await planService.getHistorial(p.planId)).filter((e) => e.tipo === 'MODIFICACION_CUOTA');
  assert.equal(h.length, 1);
});

test('Estados bloqueados: NEGOCIACION, RESUELTO y RETIRADO', async () => {
  for (const estado of ['NEGOCIACION', 'RESUELTO', 'RETIRADO']) {
    const p = await nuevoPlan({ vencidas: 1 });
    const prev = await modService.previsualizar(p.planId, 200000); // tomada con el plan ACTIVO
    await prisma.installmentPlan.update({ where: { id: p.planId }, data: { estado } });
    const prevBloq = await modService.previsualizar(p.planId, 200000);
    assert.equal(prevBloq.planModificable, false, estado); assert.equal(prevBloq.puedeConfirmar, false, estado);
    await expectReject(() => modService.modificarCuotas(p.planId, {
      nuevoMonto: 200000, motivo: 'x', user: USER, versionVistaPrevia: prev.versionVistaPrevia,
    }), 'PLAN_NO_MODIFICABLE');
    assert.equal((await cuotasDe(p.planId))[1].monto, 300000, estado);
  }
});

// ---------------------------------------------------------------- vista previa versionada
test('Vista previa desactualizada por un PAGO: se rechaza y no se aplica nada', async () => {
  const p = await nuevoPlan({ vencidas: 1 });
  await pagar(p.clientId, 150000);
  const prev = await modService.previsualizar(p.planId, 200000);
  await pagar(p.clientId, 20000); // entra un pago después de la vista previa
  const c0 = await cuotasDe(p.planId); const h0 = await prisma.planModificacionCuota.count(); const s0 = await snapshotDinero();
  await expectReject(() => modService.modificarCuotas(p.planId, {
    nuevoMonto: 200000, motivo: 'x', user: USER, versionVistaPrevia: prev.versionVistaPrevia,
  }), 'VISTA_PREVIA_DESACTUALIZADA');
  assert.deepEqual(await cuotasDe(p.planId), c0);
  assert.equal(await prisma.planModificacionCuota.count(), h0);
  assertDineroIntacto(s0, await snapshotDinero(), 'stale pago');
  // Con la vista previa actualizada sí se confirma.
  const prev2 = await modService.previsualizar(p.planId, 200000);
  assert.notEqual(prev2.versionVistaPrevia, prev.versionVistaPrevia);
  await modService.modificarCuotas(p.planId, { nuevoMonto: 200000, motivo: 'x', user: USER, versionVistaPrevia: prev2.versionVistaPrevia });
  near((await cuotasDe(p.planId))[0].pagado, 170000, 'pagado vigente');
});

test('Vista previa desactualizada por AJUSTE y por OTRA MODIFICACIÓN', async () => {
  const p = await nuevoPlan({ objetivo: 5 });
  await pagar(p.clientId, 1200000 + 100000);
  let prev = await modService.previsualizar(p.planId, 250000);
  await ajusteService.crearAjuste(p.planId, { tipo: 'CONDONACION', monto: 10000, motivo: 'x', user: USER });
  await expectReject(() => modService.modificarCuotas(p.planId, { nuevoMonto: 250000, motivo: 'x', user: USER, versionVistaPrevia: prev.versionVistaPrevia }), 'VISTA_PREVIA_DESACTUALIZADA');

  // Dos operadores con la misma vista previa: el segundo queda desactualizado.
  prev = await modService.previsualizar(p.planId, 250000);
  const prevOtro = await modService.previsualizar(p.planId, 250000);
  assert.equal(prev.versionVistaPrevia, prevOtro.versionVistaPrevia, 'misma data → misma versión');
  await modService.modificarCuotas(p.planId, { nuevoMonto: 250000, motivo: 'primero', user: USER, versionVistaPrevia: prev.versionVistaPrevia });
  await expectReject(() => modService.modificarCuotas(p.planId, { nuevoMonto: 250000, motivo: 'segundo', user: USER, versionVistaPrevia: prevOtro.versionVistaPrevia }), 'VISTA_PREVIA_DESACTUALIZADA');
  assert.equal(await prisma.planModificacionCuota.count({ where: { planId: p.planId } }), 1);
});

test('Versión ligada al importe: no se puede confirmar otro importe con la versión vista', async () => {
  const p = await nuevoPlan({ vencidas: 1 });
  const prev = await modService.previsualizar(p.planId, 200000);
  await expectReject(() => modService.modificarCuotas(p.planId, { nuevoMonto: 150000, motivo: 'x', user: USER, versionVistaPrevia: prev.versionVistaPrevia }), 'VISTA_PREVIA_DESACTUALIZADA');
  await expectReject(() => modService.modificarCuotas(p.planId, { nuevoMonto: 200000, motivo: 'x', user: USER, versionVistaPrevia: 'f'.repeat(64) }), 'VISTA_PREVIA_DESACTUALIZADA');
  await expectReject(() => modService.modificarCuotas(p.planId, { nuevoMonto: 200000, motivo: 'x', user: USER }), 'VERSION_REQUERIDA');
  assert.equal((await cuotasDe(p.planId))[1].monto, 300000);
});

// ---------------------------------------------------------------- concurrencia
test('I — Concurrencia: la confirmación espera el lock del pago y detecta el cambio', async () => {
  const p = await nuevoPlan({ vencidas: 1 });
  await pagar(p.clientId, 150000);
  const c1 = (await cuotasDe(p.planId))[0];
  const prev = await modService.previsualizar(p.planId, 200000);
  const t0 = Date.now();
  // "Pago" en curso que retiene el lock del plan 1,5 s.
  const pago = prisma.$transaction(async (tx) => {
    await lockPlan(tx, p.planId);
    await tx.installment.update({ where: { id: c1.id }, data: { pagado: 250000 } });
    await sleep(1500);
  }, { timeout: 10000 });
  await sleep(100);
  const mod = modService.modificarCuotas(p.planId, { nuevoMonto: 200000, motivo: 'race', user: USER, versionVistaPrevia: prev.versionVistaPrevia })
    .then(() => 'OK', (e) => e.message);
  try {
    const [, res] = await Promise.all([pago, mod]);
    assert.ok(Date.now() - t0 >= 1400, 'no esperó el lock');
    assert.equal(res, 'VISTA_PREVIA_DESACTUALIZADA');
    assert.equal((await cuotasDe(p.planId))[1].monto, 300000);
  } finally {
    await prisma.installment.update({ where: { id: c1.id }, data: { pagado: 150000 } }); // deshacer la simulación
  }
});

test('I2 — Concurrencia real: pago y confirmación simultáneos (30 rondas), sin sobreimputaciones', async () => {
  const resultados = { modPrimero: 0, pagoPrimero: 0 };
  for (let i = 0; i < 30; i++) {
    const p = await nuevoPlan({ vencidas: 1 });
    await pagar(p.clientId, 150000);
    const prev = await modService.previsualizar(p.planId, 200000);
    const [, m] = await Promise.all([
      pagar(p.clientId, 100000),
      sleep(Math.floor(Math.random() * 60)).then(() => modService.modificarCuotas(p.planId, {
        nuevoMonto: 200000, motivo: 'race', user: USER, versionVistaPrevia: prev.versionVistaPrevia,
      })).then(() => 'OK', (e) => e.message),
    ]);
    const c = await cuotasDe(p.planId);
    if (m === 'OK') {
      resultados.modPrimero++;
      assert.equal(c[0].monto, 200000); assert.equal(c[0].estado, 'PAGADO'); near(c[1].pagado, 50000, 'excedente a cuota 2');
    } else {
      resultados.pagoPrimero++;
      assert.equal(m, 'VISTA_PREVIA_DESACTUALIZADA');
      assert.equal(c[0].monto, 300000); near(c[0].pagado, 250000, 'pago completo en cuota 1');
    }
  }
  assert.equal(resultados.modPrimero + resultados.pagoPrimero, 30);
});

// ---------------------------------------------------------------- rollback
test('J — Rollback: falla al grabar el historial → no queda nada aplicado', async () => {
  const p = await nuevoPlan({ vencidas: 2 });
  await pagar(p.clientId, 600000);
  const c0 = await cuotasDe(p.planId); const h0 = await prisma.planModificacionCuota.count(); const s0 = await snapshotDinero();
  await prisma.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION t_fail_hist() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'fallo forzado'; END $$ LANGUAGE plpgsql`);
  await prisma.$executeRawUnsafe(`CREATE TRIGGER t_fail_hist BEFORE INSERT ON plan_modificaciones_cuota FOR EACH ROW EXECUTE FUNCTION t_fail_hist()`);
  try {
    await assert.rejects(() => modificar(p.planId, 200000));
  } finally {
    await prisma.$executeRawUnsafe(`DROP TRIGGER t_fail_hist ON plan_modificaciones_cuota`);
    await prisma.$executeRawUnsafe(`DROP FUNCTION t_fail_hist()`);
  }
  assert.deepEqual(await cuotasDe(p.planId), c0);
  assert.equal((await planDe(p.planId)).montoCuotaBase, 300000);
  assert.equal(await prisma.planModificacionCuota.count(), h0);
  assertDineroIntacto(s0, await snapshotDinero(), 'J');
});

test('J2 — Rollback: falla a mitad de las cuotas (cuota 8) → ninguna queda modificada', async () => {
  const p = await nuevoPlan({ vencidas: 2 });
  await pagar(p.clientId, 600000);
  const c0 = await cuotasDe(p.planId);
  await prisma.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION t_fail8() RETURNS trigger AS $$ BEGIN IF NEW.numero = 8 AND NEW.monto <> OLD.monto THEN RAISE EXCEPTION 'fallo cuota 8'; END IF; RETURN NEW; END $$ LANGUAGE plpgsql`);
  await prisma.$executeRawUnsafe(`CREATE TRIGGER t_fail8 BEFORE UPDATE ON installments FOR EACH ROW EXECUTE FUNCTION t_fail8()`);
  try {
    await assert.rejects(() => modificar(p.planId, 200000));
  } finally {
    await prisma.$executeRawUnsafe(`DROP TRIGGER t_fail8 ON installments`);
    await prisma.$executeRawUnsafe(`DROP FUNCTION t_fail8()`);
  }
  assert.deepEqual(await cuotasDe(p.planId), c0);
});

// ---------------------------------------------------------------- cuotas futuras
test('K — Pago abierto: las cuotas futuras se generan con el nuevo importe', async () => {
  const p = await nuevoPlan({ cuotas: 3, objetivo: 3, vencidas: 3 });
  await pagar(p.clientId, 900000);
  await planService.habilitarPagoAbierto(p.planId);
  let c = await cuotasDe(p.planId);
  assert.ok(c.length >= 4); assert.equal(c[c.length - 1].monto, 300000);
  await modificar(p.planId, 200000);
  c = await cuotasDe(p.planId);
  c.slice(3).forEach((x) => assert.equal(x.monto, 200000));
  // Simular el paso de 3 meses y materializar.
  const n0 = c.length;
  await prisma.$executeRawUnsafe(`UPDATE installments SET "fechaVencimiento" = "fechaVencimiento" - interval '3 months' WHERE "planId" = ${p.planId}`);
  const r = await planService.materializeOpenInstallments(p.planId);
  assert.ok(r.added >= 2);
  c = await cuotasDe(p.planId);
  c.slice(n0).forEach((x) => { assert.equal(x.monto, 200000, `cuota futura ${x.numero}`); assert.equal(x.total, 200000); });
});

test('Validaciones de entrada y resumen con importes distintos (rango)', async () => {
  const p = await nuevoPlan({ vencidas: 1 });
  await expectReject(() => modificar(p.planId, 0), 'INVALID_MONTO');
  await expectReject(() => modService.modificarCuotas(p.planId, { nuevoMonto: 'abc', motivo: 'x' }), 'INVALID_MONTO');
  await expectReject(() => modificar(p.planId, 200000, { motivo: '  ' }), 'MOTIVO_REQUERIDO');
  await expectReject(() => modificar(p.planId, 300000), 'SIN_CAMBIOS');
  await expectReject(() => modService.previsualizar(999999, 200000), 'PLAN_NOT_FOUND');
  assert.equal((await modService.previsualizar(p.planId)).valorActual.uniforme, true);
  await prisma.installment.updateMany({ where: { planId: p.planId, numero: 9 }, data: { monto: 280000, total: 280000 } });
  assert.deepEqual((await modService.previsualizar(p.planId)).valorActual, { min: 280000, max: 300000, uniforme: false });
});
