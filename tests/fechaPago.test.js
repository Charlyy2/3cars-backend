/**
 * Fecha CALENDARIO de los pagos (Payment.fecha = medianoche UTC del día elegido).
 * Correr también con TZ distintas: TZ=America/Argentina/Buenos_Aires / UTC / Asia/Tokyo.
 * Base AISLADA (ver tests/README.md).
 */
const { test, before, after, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { prisma, resetDb, inicioConVencidas, assertInvariantes } = require('./helpers/testDb');
const { fechaPago, rangoDia, rangoHoy, rangoMesActual } = require('../src/helpers/fechaHelper');

const planService = require('../src/services/planService');
const paymentService = require('../src/services/paymentService');
const cobranzasService = require('../src/services/cobranzasService');

const iso = (d) => d.toISOString();
const pad = (n) => String(n).padStart(2, '0');
const hoyISO = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };

before(resetDb);
after(() => prisma.$disconnect());
afterEach(async (t) => { await assertInvariantes(t.name); });

// ---------------------------------------------------------------- helper (puro)
test('fechaPago: "YYYY-MM-DD" → medianoche UTC (igual que antes), en cualquier zona', () => {
  assert.equal(iso(fechaPago('2026-11-24')), '2026-11-24T00:00:00.000Z');
  assert.equal(iso(fechaPago('2026-11-24')), iso(new Date('2026-11-24')), 'misma convención histórica');
  assert.throws(() => fechaPago('24/11/2026x'), { message: 'FECHA_INVALIDA' });
});

test('fechaPago sin fecha: día calendario del reloj del servidor, también de noche', () => {
  const nocheLocal = new Date(2026, 10, 23, 23, 30); // 23/11 23:30 hora del servidor
  assert.equal(iso(fechaPago(undefined, nocheLocal)), '2026-11-23T00:00:00.000Z');
  assert.equal(iso(fechaPago('', new Date(2026, 0, 1, 0, 5))), '2026-01-01T00:00:00.000Z');
});

test('Rangos de día / hoy / mes: límites UTC del día calendario', () => {
  assert.deepEqual(rangoDia('2026-11-24'), { gte: new Date('2026-11-24T00:00:00Z'), lt: new Date('2026-11-25T00:00:00Z') });
  const ahora = new Date(2026, 10, 30, 23, 59); // último día del mes, de noche (hora del servidor)
  assert.deepEqual(rangoHoy(ahora), { gte: new Date('2026-11-30T00:00:00Z'), lt: new Date('2026-12-01T00:00:00Z') });
  assert.deepEqual(rangoMesActual(ahora), { gte: new Date('2026-11-01T00:00:00Z'), lt: new Date('2026-12-01T00:00:00Z') });
});

// ---------------------------------------------------------------- integración
let cliente;
test('Pago con fecha elegida: se guarda en su día y los filtros/informes lo ubican ahí', async () => {
  const c = await prisma.client.create({ data: { nombre: 'Fechas' } });
  cliente = c.id;
  await planService.createPlan({
    clientId: c.id, montoCuotaBase: 100000, cantidadCuotas: 10, fechaInicio: inicioConVencidas(1),
    selladoMonto: 0, cuotasConSellado: 2, cuotaObjetivoRetiro: 0, primerCuotaPagada: false,
  });
  const r = await paymentService.createPayment(c.id, 1000, undefined, '2026-11-01');
  assert.equal(iso(r.payment.fecha), '2026-11-01T00:00:00.000Z');

  const delDia = await paymentService.getAllPayments({ fechaDesde: '2026-11-01', fechaHasta: '2026-11-01' });
  assert.ok(delDia.data.some((p) => p.id === r.payment.id), 'el filtro del 01/11 debe incluirlo');
  const diaAnterior = await paymentService.getAllPayments({ fechaDesde: '2026-10-31', fechaHasta: '2026-10-31' });
  assert.ok(!diaAnterior.data.some((p) => p.id === r.payment.id), 'no debe caer en el 31/10');

  const resumen = await paymentService.getMonthlySummary('2026-11');
  assert.deepEqual(resumen.map((x) => x.mes), ['2026-11'], 'primer día del mes en su mes');
  assert.deepEqual(await paymentService.getMonthlySummary('2026-10'), []);
});

test('Pago sin fecha (hoy): aparece en las métricas del día y del mes', async () => {
  const antesDia = await cobranzasService.getMetricasDelDia();
  const antesMes = await cobranzasService.getMetricasDelMes();
  const r = await paymentService.createPayment(cliente, 2500);
  assert.equal(iso(r.payment.fecha), `${hoyISO()}T00:00:00.000Z`);
  const dia = await cobranzasService.getMetricasDelDia();
  const mes = await cobranzasService.getMetricasDelMes();
  assert.equal(dia.cantidadPagos, antesDia.cantidadPagos + 1);
  assert.equal(dia.totalCobrado, antesDia.totalCobrado + 2500);
  assert.equal(mes.totalCobrado, antesMes.totalCobrado + 2500);
  const hoy = await paymentService.getAllPayments({ fechaDesde: hoyISO(), fechaHasta: hoyISO() });
  assert.ok(hoy.data.some((p) => p.id === r.payment.id));
});

test('Caja no depende de Payment.fecha: el movimiento usa el instante real de registro', async () => {
  const r = await paymentService.createPayment(cliente, 700, undefined, '2026-10-15'); // pago fechado en el pasado
  const movs = await prisma.cashMovement.findMany({ where: { paymentId: r.payment.id } });
  assert.equal(movs.length, 1);
  assert.ok(Date.now() - movs[0].createdAt.getTime() < 60000, 'Caja registra cuándo se cargó, no la fecha elegida');
});

test('Datos históricos: la corrección no reescribe fechas guardadas', async () => {
  const p = await prisma.payment.create({ data: { clientId: cliente, montoTotal: 1, montoAplicado: 1, fecha: new Date('2026-09-10T00:00:00Z') } });
  await paymentService.getAllPayments({ fechaDesde: '2026-09-10', fechaHasta: '2026-09-10' });
  assert.equal(iso((await prisma.payment.findUnique({ where: { id: p.id } })).fecha), '2026-09-10T00:00:00.000Z');
  await prisma.payment.delete({ where: { id: p.id } });
});
