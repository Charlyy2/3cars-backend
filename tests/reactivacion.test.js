/**
 * Planes CAÍDOS: cobro dirigido, reactivación explícita y estados terminales.
 * Base AISLADA (ver tests/README.md). Los casos corren en orden y comparten la base.
 */
const { test, before, after, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const {
  prisma, H, near, sleep, resetDb, inicioConVencidas, snapshotDinero, assertDineroIntacto, assertInvariantes,
} = require('./helpers/testDb');

const planService = require('../src/services/planService');
const paymentService = require('../src/services/paymentService');
const installmentService = require('../src/services/installmentService');
const reactivacionService = require('../src/services/reactivacionService');
const { lockPlan } = require('../src/helpers/lockHelper');

const USER = { id: 1, username: 'gustavo' };

let seq = 0;
const nuevoCliente = () => prisma.client.create({ data: { nombre: `Reactivación ${++seq}` } });
const nuevoPlan = async ({ clientId, vencidas = 5, cuotas = 10, monto = 300000 } = {}) => {
  const cid = clientId || (await nuevoCliente()).id;
  const { plan } = await planService.createPlan({
    clientId: cid, montoCuotaBase: monto, cantidadCuotas: cuotas, fechaInicio: inicioConVencidas(vencidas),
    selladoMonto: 0, cuotasConSellado: 2, cuotaObjetivoRetiro: 0, primerCuotaPagada: false,
  });
  return { clientId: cid, planId: plan.id };
};
/** Plan que cae por mora: 5 vencidas, se paga solo la 1 → 4 vencidas impagas → CAIDO. */
const planCaido = async () => {
  const p = await nuevoPlan();
  await paymentService.createPayment(p.clientId, 300000);
  assert.equal((await planDe(p.planId)).estado, 'CAIDO');
  return p;
};
const planDe = (id) => prisma.installmentPlan.findUnique({ where: { id } });
const cuotasDe = (planId) => prisma.installment.findMany({ where: { planId }, orderBy: { numero: 'asc' } });
const pagarPlan = (clientId, planId, monto) => paymentService.createPayment(clientId, monto, undefined, undefined, { planId });
const consultarCuotas = (clientId) => installmentService.getInstallmentsByClientId(clientId); // dispara la caída automática
const reactivar = async (planId, extra = {}) => {
  const prev = await reactivacionService.previsualizar(planId);
  return reactivacionService.reactivarPlan(planId, { motivo: 'Cliente regularizó', user: USER, versionVistaPrevia: prev.versionVistaPrevia, ...extra });
};
const expectReject = async (fn, code) => {
  try { await fn(); } catch (e) { assert.equal(e.message, code, `se esperaba ${code}, vino ${e.message}`); return e; }
  return assert.fail(`se esperaba rechazo ${code}`);
};
const movimientosDeCuota = async (installmentId) =>
  prisma.cashMovement.findMany({ where: { installmentId }, include: { category: true } });

before(resetDb);
after(() => prisma.$disconnect());
afterEach(async (t) => { await assertInvariantes(t.name); });

// ---------------------------------------------------------------- caída automática y estados terminales
test('Verificación de mora: un ACTIVO con 3+ vencidas cae con origen MORA_AUTOMATICA', async () => {
  const p = await nuevoPlan(); // ACTIVO, 5 vencidas impagas (createPlan no recalcula)
  await planService.checkAndCancelOverduePlans();
  const plan = await planDe(p.planId);
  assert.equal(plan.estado, 'CAIDO'); assert.equal(plan.motivoCaida, 'MORA_AUTOMATICA');
});

test('Estados terminales: RESUELTO, RETIRADO y NEGOCIACION no caen al consultar cuotas', async () => {
  // RESUELTO por el flujo real: resolver con 2 vencidas y luego dejar pasar el tiempo.
  const r = await nuevoPlan({ vencidas: 2 });
  await planService.resolverPlan(r.planId, { vehiculo: 'NO_RETIRO', createdBy: 'gustavo' });
  await prisma.$executeRawUnsafe(`UPDATE installments SET "fechaVencimiento" = "fechaVencimiento" - interval '4 months' WHERE "planId" = ${r.planId}`);
  const cuotasAntes = await cuotasDe(r.planId);
  assert.ok(await installmentService.contarVencidasImpagas(prisma, r.planId) >= 3);
  await consultarCuotas(r.clientId);
  await installmentService.getPlansByClientId(r.clientId);
  assert.equal((await planDe(r.planId)).estado, 'RESUELTO');
  assert.deepEqual(await cuotasDe(r.planId), cuotasAntes, 'cuotas históricas intactas');

  for (const estado of ['RETIRADO', 'NEGOCIACION']) {
    const p = await nuevoPlan();
    await prisma.installmentPlan.update({ where: { id: p.planId }, data: { estado } });
    await consultarCuotas(p.clientId);
    assert.equal((await planDe(p.planId)).estado, estado, `${estado} cambió de estado`);
  }
  // Regresión: un ACTIVO sí cae.
  const a = await nuevoPlan();
  await consultarCuotas(a.clientId);
  assert.equal((await planDe(a.planId)).estado, 'CAIDO');
});

// ---------------------------------------------------------------- cobro de un plan CAÍDO (secuencia)
let pc; // plan caído compartido por los casos siguientes
test('Pago parcial en CAIDO: se registra con Caja, el plan sigue CAIDO', async () => {
  pc = await planCaido();
  assert.equal((await planDe(pc.planId)).motivoCaida, 'MORA_AUTOMATICA');
  // Sin plan de destino, el comportamiento histórico no cambia: no cobra un plan CAIDO.
  await expectReject(() => paymentService.createPayment(pc.clientId, 100000), 'SIN_CUOTAS_EXIGIBLES');

  const r = await pagarPlan(pc.clientId, pc.planId, 100000);
  assert.equal(r.allocations.length, 1);
  const c = await cuotasDe(pc.planId);
  assert.equal(c[1].pagado, 100000); assert.equal(c[1].estado, 'PARCIAL');
  const mov = await movimientosDeCuota(c[1].id);
  assert.equal(mov.length, 1); assert.equal(mov[0].category.name, 'COBRO_CUOTA'); assert.equal(mov[0].amount, 100000);
  const plan = await planDe(pc.planId);
  assert.equal(plan.estado, 'CAIDO', 'un pago no reactiva'); assert.equal(plan.motivoCaida, 'MORA_AUTOMATICA');
});

test('Varios pagos parciales acumulados: siguen sin reactivar; el mínimo se recalcula', async () => {
  let prev = await reactivacionService.previsualizar(pc.planId);
  assert.equal(prev.cuotasVencidasImpagas, 4); assert.equal(prev.cuotasARegularizar, 2);
  near(prev.montoMinimo, 200000 + 300000, 'mínimo c2 (resto) + c3');
  assert.equal(prev.puedeReactivar, false); assert.match(prev.motivoBloqueo, /regularizar 2 cuota/);

  await pagarPlan(pc.clientId, pc.planId, 250000); // c2 saldada, c3 parcial 50k
  await consultarCuotas(pc.clientId);
  prev = await reactivacionService.previsualizar(pc.planId);
  assert.equal(prev.cuotasVencidasImpagas, 3); assert.equal(prev.cuotasARegularizar, 1); near(prev.montoMinimo, 250000, 'mínimo c3');
  assert.equal((await planDe(pc.planId)).estado, 'CAIDO');
});

test('Rechazo de reactivación con 3 cuotas vencidas: no cambia nada', async () => {
  const p0 = await planDe(pc.planId); const s0 = await snapshotDinero();
  const e = await expectReject(() => reactivar(pc.planId), 'REACTIVACION_NO_CUMPLE');
  assert.equal(e.preview.cuotasARegularizar, 1);
  assert.deepEqual(await planDe(pc.planId), p0);
  assert.equal(await prisma.planReactivacion.count(), 0);
  assertDineroIntacto(s0, await snapshotDinero(), 'rechazo');
});

test('Reactivación explícita sin nuevo pago cuando ya está regularizado; no vuelve a caer', async () => {
  await pagarPlan(pc.clientId, pc.planId, 250000); // c3 saldada → quedan 2 vencidas
  await consultarCuotas(pc.clientId);
  assert.equal((await planDe(pc.planId)).estado, 'CAIDO', 'regularizar no reactiva solo');
  const prev = await reactivacionService.previsualizar(pc.planId);
  assert.equal(prev.cuotasVencidasImpagas, 2); assert.equal(prev.montoMinimo, 0); assert.equal(prev.puedeReactivar, true);
  assert.equal(prev.requiereConfirmacionOrigen, false);

  const venc0 = (await cuotasDe(pc.planId)).map((c) => c.fechaVencimiento.getTime());
  const s0 = await snapshotDinero();
  const r = await reactivacionService.reactivarPlan(pc.planId, { motivo: 'Regularizó las cuotas atrasadas', user: USER, versionVistaPrevia: prev.versionVistaPrevia });
  assert.equal(r.plan.estado, 'ACTIVO'); assert.equal(r.plan.motivoCaida, null);
  assert.equal(r.reactivacion.createdBy, 'gustavo'); assert.equal(r.reactivacion.motivoCaidaAnterior, 'MORA_AUTOMATICA');
  assert.equal(r.reactivacion.cuotasVencidasImpagas, 2);
  assertDineroIntacto(s0, await snapshotDinero(), 'reactivación');
  assert.deepEqual((await cuotasDe(pc.planId)).map((c) => c.fechaVencimiento.getTime()), venc0, 'vencimientos intactos');

  await consultarCuotas(pc.clientId);
  assert.equal((await planDe(pc.planId)).estado, 'ACTIVO', 'no vuelve a caer al consultar');
  // Ya ACTIVO: el pago normal (sin plan de destino) vuelve a imputarle.
  await paymentService.createPayment(pc.clientId, 300000);
  assert.equal((await cuotasDe(pc.planId))[3].estado, 'PAGADO');
  const h = (await planService.getHistorial(pc.planId)).filter((e) => e.tipo === 'REACTIVACION');
  assert.equal(h.length, 1); assert.equal(h[0].usuario, 'gustavo'); assert.equal(h[0].motivo, 'Regularizó las cuotas atrasadas');
});

// ---------------------------------------------------------------- otro plan del mismo cliente
test('Cliente con plan CAIDO y otro ACTIVO: pagos sin mezclas; no se reactiva', async () => {
  const viejo = await planCaido();
  const nuevo = await nuevoPlan({ clientId: viejo.clientId, vencidas: 1 });
  const cuotasViejo0 = await cuotasDe(viejo.planId);
  const cuotasNuevo0 = await cuotasDe(nuevo.planId);

  // Sin plan de destino: solo el plan ACTIVO (el CAIDO no se toca aunque tenga cuotas más viejas).
  await paymentService.createPayment(viejo.clientId, 50000);
  assert.deepEqual(await cuotasDe(viejo.planId), cuotasViejo0, 'tocó el plan CAIDO');
  assert.equal((await cuotasDe(nuevo.planId))[0].pagado, 50000);

  // Con plan de destino CAIDO: solo ese plan.
  const cuotasNuevo1 = await cuotasDe(nuevo.planId);
  await pagarPlan(viejo.clientId, viejo.planId, 70000);
  assert.deepEqual(await cuotasDe(nuevo.planId), cuotasNuevo1, 'tocó el plan ACTIVO');
  assert.equal((await cuotasDe(viejo.planId))[1].pagado, 70000);
  assert.notDeepEqual(cuotasNuevo0, cuotasNuevo1);

  // El plan "del cliente" es el vigente, con o sin incluirCaido.
  assert.equal((await planService.getPlanByClientId(viejo.clientId)).id, nuevo.planId);
  assert.equal((await planService.getPlanByClientId(viejo.clientId, { incluirCaido: true })).id, nuevo.planId);

  // No puede haber dos planes vigentes: reactivación bloqueada aunque cumpliera la regla.
  await pagarPlan(viejo.clientId, viejo.planId, 1000000);
  const prev = await reactivacionService.previsualizar(viejo.planId);
  assert.equal(prev.otroPlanVigente.id, nuevo.planId); assert.equal(prev.puedeReactivar, false);
  await expectReject(() => reactivar(viejo.planId), 'OTRO_PLAN_VIGENTE');
  assert.equal((await planDe(viejo.planId)).estado, 'CAIDO');
});

test('Plan de destino inválido: de otro cliente, inexistente o en estado que no admite pagos', async () => {
  const a = await planCaido();
  const b = await nuevoPlan({ vencidas: 1 });
  const s0 = await snapshotDinero();
  await expectReject(() => pagarPlan(b.clientId, a.planId, 1000), 'PLAN_DESTINO_INVALIDO');
  await expectReject(() => pagarPlan(b.clientId, 999999, 1000), 'PLAN_DESTINO_INVALIDO');
  await prisma.installmentPlan.update({ where: { id: a.planId }, data: { estado: 'RESUELTO' } });
  await expectReject(() => pagarPlan(a.clientId, a.planId, 1000), 'PLAN_NO_ADMITE_PAGOS');
  assertDineroIntacto(s0, await snapshotDinero(), 'destino inválido');
});

// ---------------------------------------------------------------- origen de la caída
test('Baja manual y caída de origen desconocido: advertencia + confirmación explícita', async () => {
  const m = await nuevoPlan({ vencidas: 1 });
  await planService.cancelPlan(m.planId); // botón "dar de baja"
  assert.equal((await planDe(m.planId)).motivoCaida, 'BAJA_MANUAL');
  let prev = await reactivacionService.previsualizar(m.planId);
  assert.equal(prev.puedeReactivar, true); assert.equal(prev.requiereConfirmacionOrigen, true);
  assert.match(prev.advertenciaOrigen, /dado de baja manualmente/);
  await expectReject(() => reactivar(m.planId), 'CONFIRMACION_ORIGEN_REQUERIDA');
  assert.equal((await planDe(m.planId)).estado, 'CAIDO');
  const r = await reactivar(m.planId, { confirmaOrigenCaida: true });
  assert.equal(r.plan.estado, 'ACTIVO'); assert.equal(r.reactivacion.origenConfirmado, true);
  assert.equal(r.reactivacion.motivoCaidaAnterior, 'BAJA_MANUAL');

  // Datos existentes (caídos antes de registrar el origen): motivoCaida = null.
  const l = await nuevoPlan({ vencidas: 1 });
  await prisma.installmentPlan.update({ where: { id: l.planId }, data: { estado: 'CAIDO', motivoCaida: null } });
  prev = await reactivacionService.previsualizar(l.planId);
  assert.equal(prev.requiereConfirmacionOrigen, true); assert.match(prev.advertenciaOrigen, /No se puede determinar/);
  await expectReject(() => reactivar(l.planId), 'CONFIRMACION_ORIGEN_REQUERIDA');
  assert.equal((await reactivar(l.planId, { confirmaOrigenCaida: true })).plan.estado, 'ACTIVO');
});

test('Validaciones: motivo, versión, estado no CAIDO', async () => {
  const p = await planCaido();
  await pagarPlan(p.clientId, p.planId, 600000);
  const prev = await reactivacionService.previsualizar(p.planId);
  await expectReject(() => reactivacionService.reactivarPlan(p.planId, { motivo: ' ', versionVistaPrevia: prev.versionVistaPrevia }), 'MOTIVO_REQUERIDO');
  await expectReject(() => reactivacionService.reactivarPlan(p.planId, { motivo: 'x' }), 'VERSION_REQUERIDA');
  await expectReject(() => reactivacionService.reactivarPlan(p.planId, { motivo: 'x', versionVistaPrevia: 'a'.repeat(64) }), 'VISTA_PREVIA_DESACTUALIZADA');
  const activo = await nuevoPlan({ vencidas: 1 });
  const pa = await reactivacionService.previsualizar(activo.planId);
  assert.equal(pa.puedeReactivar, false);
  await expectReject(() => reactivacionService.reactivarPlan(activo.planId, { motivo: 'x', versionVistaPrevia: pa.versionVistaPrevia }), 'PLAN_NO_CAIDO');
});

// ---------------------------------------------------------------- vista previa / concurrencia / rollback
/** Plan CAIDO por mora que ya cumple la condición de reactivación (2 vencidas). */
const planCaidoReactivable = async () => {
  const p = await planCaido();
  await pagarPlan(p.clientId, p.planId, 600000); // c2 y c3 saldadas
  return p;
};

test('Vista previa desactualizada: un pago posterior invalida la confirmación', async () => {
  const p = await planCaidoReactivable();
  const prev = await reactivacionService.previsualizar(p.planId);
  await pagarPlan(p.clientId, p.planId, 10000);
  await expectReject(() => reactivacionService.reactivarPlan(p.planId, { motivo: 'x', user: USER, versionVistaPrevia: prev.versionVistaPrevia }), 'VISTA_PREVIA_DESACTUALIZADA');
  assert.equal((await planDe(p.planId)).estado, 'CAIDO');
});

test('Concurrencia: la reactivación espera el lock y revalida', async () => {
  const p = await planCaidoReactivable();
  const prev = await reactivacionService.previsualizar(p.planId);
  const c4 = (await cuotasDe(p.planId))[3];
  const t0 = Date.now();
  const pago = prisma.$transaction(async (tx) => {
    await lockPlan(tx, p.planId);
    await tx.installment.update({ where: { id: c4.id }, data: { pagado: 1000, estado: 'PARCIAL' } });
    await sleep(1500);
  }, { timeout: 10000 });
  await sleep(100);
  const rea = reactivacionService.reactivarPlan(p.planId, { motivo: 'race', user: USER, versionVistaPrevia: prev.versionVistaPrevia })
    .then(() => 'OK', (e) => e.message);
  try {
    const [, res] = await Promise.all([pago, rea]);
    assert.ok(Date.now() - t0 >= 1400, 'no esperó el lock');
    assert.equal(res, 'VISTA_PREVIA_DESACTUALIZADA');
    assert.equal((await planDe(p.planId)).estado, 'CAIDO');
  } finally {
    await prisma.installment.update({ where: { id: c4.id }, data: { pagado: 0, estado: 'PENDIENTE' } });
  }
});

test('Concurrencia real: pago dirigido y reactivación simultáneos (20 rondas) + doble reactivación', async () => {
  for (let i = 0; i < 20; i++) {
    const p = await planCaidoReactivable();
    const prev = await reactivacionService.previsualizar(p.planId);
    const [, res] = await Promise.all([
      pagarPlan(p.clientId, p.planId, 50000),
      sleep(Math.floor(Math.random() * 60)).then(() => reactivacionService.reactivarPlan(p.planId, {
        motivo: 'race', user: USER, versionVistaPrevia: prev.versionVistaPrevia,
      })).then(() => 'OK', (e) => e.message),
    ]);
    const plan = await planDe(p.planId);
    if (res === 'OK') assert.equal(plan.estado, 'ACTIVO');
    else { assert.equal(res, 'VISTA_PREVIA_DESACTUALIZADA'); assert.equal(plan.estado, 'CAIDO'); }
    near((await cuotasDe(p.planId))[3].pagado, 50000, 'el pago siempre se imputa a la cuota 4');
  }
  // Dos operadores reactivan a la vez: una sola reactivación.
  const p = await planCaidoReactivable();
  const prev = await reactivacionService.previsualizar(p.planId);
  const rs = await Promise.all([1, 2].map(() => reactivacionService.reactivarPlan(p.planId, {
    motivo: 'doble', user: USER, versionVistaPrevia: prev.versionVistaPrevia,
  }).then(() => 'OK', (e) => e.message)));
  assert.deepEqual(rs.sort(), ['OK', 'PLAN_NO_CAIDO']);
  assert.equal(await prisma.planReactivacion.count({ where: { planId: p.planId } }), 1);
});

test('Rollback: falla al grabar la auditoría → el plan sigue CAIDO', async () => {
  const p = await planCaidoReactivable();
  const p0 = await planDe(p.planId); const s0 = await snapshotDinero();
  await prisma.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION t_fail_reac() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'fallo forzado'; END $$ LANGUAGE plpgsql`);
  await prisma.$executeRawUnsafe(`CREATE TRIGGER t_fail_reac BEFORE INSERT ON plan_reactivaciones FOR EACH ROW EXECUTE FUNCTION t_fail_reac()`);
  try {
    await assert.rejects(() => reactivar(p.planId));
  } finally {
    await prisma.$executeRawUnsafe(`DROP TRIGGER t_fail_reac ON plan_reactivaciones`);
    await prisma.$executeRawUnsafe(`DROP FUNCTION t_fail_reac()`);
  }
  assert.deepEqual(await planDe(p.planId), p0);
  assert.equal(await prisma.planReactivacion.count({ where: { planId: p.planId } }), 0);
  assertDineroIntacto(s0, await snapshotDinero(), 'rollback');
});
