/**
 * Endpoints de "Modificar valor de cuota" sobre el servidor real (src/index.js)
 * levantado contra la base AISLADA de pruebas. Ver tests/README.md.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const path = require('node:path');
const { prisma, resetDb, inicioConVencidas } = require('./helpers/testDb');
const jwt = require('jsonwebtoken');

// Secreto efímero generado por corrida (no es una credencial real).
const JWT_SECRET = crypto.randomBytes(32).toString('hex');
const PORT = 41000 + Math.floor(Math.random() * 2000);
const BASE = `http://127.0.0.1:${PORT}`;
let server;

const token = (role) => jwt.sign({ id: 1, username: role === 'VIEWER' ? 'lector' : 'gustavo', role }, JWT_SECRET);
const call = async (method, url, body, role = 'USER') => {
  const r = await fetch(BASE + url, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token(role)}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, body: await r.json().catch(() => null) };
};

before(async () => {
  await resetDb();
  server = spawn(process.execPath, [path.join(__dirname, '..', 'src', 'index.js')], {
    env: { ...process.env, DATABASE_URL: process.env.TEST_DATABASE_URL, JWT_SECRET, PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('el servidor no arrancó')), 15000);
    server.stdout.on('data', (d) => { if (String(d).includes('Servidor corriendo')) { clearTimeout(t); resolve(); } });
    server.on('exit', (code) => reject(new Error(`el servidor terminó (${code})`)));
  });
});

after(async () => {
  if (server) server.kill();
  await prisma.$disconnect();
});

const crearPlan = async ({ vencidas = 5 } = {}) => {
  const c = await call('POST', '/clients', { nombre: 'HTTP test' });
  const clientId = c.body.id;
  const p = await call('POST', '/plans', {
    clientId, montoCuotaBase: 300000, cantidadCuotas: 10, fechaInicio: inicioConVencidas(vencidas).toISOString(),
    selladoMonto: 0, cuotaObjetivoRetiro: 0, primerCuotaPagada: false,
  });
  assert.equal(p.status, 201);
  return { clientId, planId: p.body.plan.id };
};

test('flujo completo: vista previa → confirmar con versión → Caja intacta → historial', async () => {
  const { clientId, planId } = await crearPlan();
  assert.equal((await call('POST', '/payments', { clientId, monto: 1200000 })).status, 201);

  const resumen = await call('GET', `/plans/${planId}/modificar-cuotas/preview`);
  assert.equal(resumen.status, 200); assert.equal(resumen.body.cuotasAbiertas, 6); assert.equal(resumen.body.deudaActual, 1800000);
  assert.equal((await call('GET', `/plans/${planId}/modificar-cuotas/preview?nuevoMonto=-5`)).status, 400);
  const prev = await call('GET', `/plans/${planId}/modificar-cuotas/preview?nuevoMonto=200000`);
  assert.equal(prev.body.deudaNueva, 1200000); assert.match(prev.body.versionVistaPrevia, /^[0-9a-f]{64}$/);

  const sinVersion = await call('POST', `/plans/${planId}/modificar-cuotas`, { nuevoMonto: 200000, motivo: 'x' });
  assert.equal(sinVersion.status, 400); assert.equal(sinVersion.body.code, 'VERSION_REQUERIDA');
  const lector = await call('POST', `/plans/${planId}/modificar-cuotas`, { nuevoMonto: 200000, motivo: 'x', versionVistaPrevia: prev.body.versionVistaPrevia }, 'VIEWER');
  assert.equal(lector.status, 403); assert.equal(lector.body.code, 'READ_ONLY');

  const caja0 = (await call('GET', '/cash-movements/summary')).body;
  const pagos0 = (await call('GET', `/payments/${clientId}`)).body;
  const ok = await call('POST', `/plans/${planId}/modificar-cuotas`, {
    nuevoMonto: 200000, motivo: 'El cliente necesita una cuota más accesible', versionVistaPrevia: prev.body.versionVistaPrevia,
  });
  assert.equal(ok.status, 201, JSON.stringify(ok.body)); assert.equal(ok.body.deudaPendiente, 1200000);
  assert.deepEqual((await call('GET', '/cash-movements/summary')).body, caja0, 'Caja cambió');
  assert.deepEqual((await call('GET', `/payments/${clientId}`)).body, pagos0, 'pagos cambiaron');

  // Reusar la misma vista previa ya no es válido (los datos cambiaron).
  const stale = await call('POST', `/plans/${planId}/modificar-cuotas`, { nuevoMonto: 200000, motivo: 'otra', versionVistaPrevia: prev.body.versionVistaPrevia });
  assert.equal(stale.status, 409); assert.equal(stale.body.code, 'VISTA_PREVIA_DESACTUALIZADA');

  assert.equal((await call('GET', `/plans?clientId=${clientId}`)).body.montoCuotaBase, 200000);
  assert.equal((await call('GET', `/plans/${planId}`)).status, 200);
  const hist = await call('GET', `/plans/${planId}/historial`);
  assert.equal(hist.body.filter((e) => e.tipo === 'MODIFICACION_CUOTA').length, 1);
  const cuotas = (await call('GET', `/installments/installments/${clientId}`)).body;
  assert.deepEqual(cuotas.map((x) => x.monto), [300000, 300000, 300000, 300000, 200000, 200000, 200000, 200000, 200000, 200000]);
  assert.equal((await call('GET', `/sales/${planId}/metrics`)).status, 200);
  assert.equal((await call('GET', '/dashboard/metrics')).status, 200);
});

test('plan CAÍDO: visible por cliente, modificable, sigue CAIDO', async () => {
  const { clientId, planId } = await crearPlan();
  await call('POST', '/payments', { clientId, monto: 300000 }); // 4 vencidas impagas → CAIDO
  // Comportamiento por defecto intacto (listado de clientes): sin plan vigente → 404.
  assert.equal((await call('GET', `/plans?clientId=${clientId}`)).status, 404);
  const plan = await call('GET', `/plans?clientId=${clientId}&incluirCaido=true`);
  assert.equal(plan.status, 200); assert.equal(plan.body.estado, 'CAIDO');
  const prev = await call('GET', `/plans/${planId}/modificar-cuotas/preview?nuevoMonto=200000`);
  assert.equal(prev.body.planCaido, true);
  assert.equal(prev.body.avisoEstado, 'Se modificarán las cuotas pendientes, pero el plan continuará en estado CAÍDO.');
  const ok = await call('POST', `/plans/${planId}/modificar-cuotas`, { nuevoMonto: 200000, motivo: 'Recuperar', versionVistaPrevia: prev.body.versionVistaPrevia });
  assert.equal(ok.status, 201);
  assert.equal((await call('GET', `/plans/${planId}`)).body.estado, 'CAIDO');
  assert.equal((await call('GET', `/clients/${clientId}/status`)).body.estado, 'CAIDO');
});

test('plan CAÍDO por HTTP: pago dirigido (sigue CAIDO) y reactivación explícita', async () => {
  const { clientId, planId } = await crearPlan();
  await call('POST', '/payments', { clientId, monto: 300000 }); // cae por mora
  const sinDestino = await call('POST', '/payments', { clientId, monto: 1000 });
  assert.equal(sinDestino.status, 409);
  const dirigido = await call('POST', '/payments', { clientId, monto: 600000, planId });
  assert.equal(dirigido.status, 201, JSON.stringify(dirigido.body));
  assert.equal((await call('GET', `/plans/${planId}`)).body.estado, 'CAIDO');

  const prev = await call('GET', `/plans/${planId}/reactivar/preview`);
  assert.equal(prev.status, 200); assert.equal(prev.body.puedeReactivar, true); assert.equal(prev.body.cuotasVencidasImpagas, 2);
  assert.equal((await call('POST', `/plans/${planId}/reactivar`, { motivo: 'x' })).status, 400);
  const lector = await call('POST', `/plans/${planId}/reactivar`, { motivo: 'x', versionVistaPrevia: prev.body.versionVistaPrevia }, 'VIEWER');
  assert.equal(lector.status, 403);
  const caja0 = (await call('GET', '/cash-movements/summary')).body;
  const ok = await call('POST', `/plans/${planId}/reactivar`, { motivo: 'Regularizó', versionVistaPrevia: prev.body.versionVistaPrevia });
  assert.equal(ok.status, 201, JSON.stringify(ok.body)); assert.equal(ok.body.plan.estado, 'ACTIVO');
  assert.deepEqual((await call('GET', '/cash-movements/summary')).body, caja0, 'la reactivación movió Caja');
  await call('GET', `/installments/installments/${clientId}`); // dispara la verificación de caída
  assert.equal((await call('GET', `/plans?clientId=${clientId}`)).body.estado, 'ACTIVO');
  const otro = await call('POST', '/payments', { clientId, monto: 1000, planId: 999999 });
  assert.equal(otro.status, 400); assert.equal(otro.body.code, 'PLAN_DESTINO_INVALIDO');
});
