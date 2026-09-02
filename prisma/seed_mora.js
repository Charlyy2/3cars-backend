/**
 * Seed de datos FAKE para probar la mora (planes vs negociación/saldo).
 *
 * Crea 2 clientes de prueba (idempotente: si ya existen por su DNI marcador,
 * se borran en cascada y se recrean):
 *
 *   A) "SEED Plan Vencido"    → plan ACTIVO con cuotas vencidas impagas  → mora de PLAN.
 *   B) "SEED Saldo Negociado" → plan PAGADO + negociación (auto retirado) + etapa SALDO
 *                               con cuotas de saldo vencidas             → mora de NEGOCIACIÓN.
 *
 * Además deja las tasas de mora en la config en un valor visible:
 *   moraDiariaPlan = 0.5 %/día   |   moraDiariaNegociacion = 1.0 %/día
 *
 * Uso:
 *   cd backend
 *   node prisma/seed_mora.js
 *
 * Para limpiar sin recrear:
 *   node prisma/seed_mora.js --clean
 */
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const SEED_DNIS = ['90000001', '90000002'];
const round = (v) => Math.round((Number(v || 0) + Number.EPSILON) * 100) / 100;

// ---- helpers de fecha ----
const now = new Date();
const daysAgo = (n) => { const d = new Date(now); d.setDate(d.getDate() - n); d.setHours(12, 0, 0, 0); return d; };
const daysFromNow = (n) => daysAgo(-n);
const monthsAgo = (n) => { const d = new Date(now); d.setMonth(d.getMonth() - n); d.setHours(12, 0, 0, 0); return d; };
const addMonths = (base, n) => { const d = new Date(base); d.setMonth(d.getMonth() + n); return d; };
const diasAtraso = (fecha) => Math.floor((now - new Date(fecha)) / (1000 * 60 * 60 * 24));
const mkCargos = () => ({ comision: 0, gastoRetiro: 0, administrativo: 0, sellado: 0, mora: 0 });

// Borrado en cascada de un cliente (mismo orden que clientService.deleteClient).
async function deleteClientCascade(clientId) {
  await prisma.$transaction(async (tx) => {
    await tx.paymentAllocation.deleteMany({ where: { payment: { clientId } } });
    await tx.cashMovement.deleteMany({
      where: { OR: [{ clientId }, { payment: { clientId } }, { installment: { plan: { clientId } } }] },
    });
    await tx.payment.deleteMany({ where: { clientId } });
    await tx.saldoCuota.deleteMany({ where: { plan: { clientId } } });
    await tx.installment.deleteMany({ where: { plan: { clientId } } });
    await tx.financing.deleteMany({ where: { clientId } });
    await tx.installmentPlan.deleteMany({ where: { clientId } });
    await tx.customerBalance.deleteMany({ where: { clientId } });
    await tx.audio.deleteMany({ where: { clientId } });
    await tx.vehicle.updateMany({ where: { clientId }, data: { clientId: null, disponible: true } });
    await tx.client.delete({ where: { id: clientId } });
  });
}

async function limpiarSeedPrevio() {
  const existentes = await prisma.client.findMany({ where: { dni: { in: SEED_DNIS } }, select: { id: true, nombre: true } });
  for (const c of existentes) {
    await deleteClientCascade(c.id);
    console.log(`🧹 Borrado cliente previo #${c.id} (${c.nombre})`);
  }
}

async function setTasasMora() {
  const cfg = await prisma.config.findFirst({ orderBy: { id: 'asc' } });
  const data = { moraDiariaPlan: 0.5, moraDiariaNegociacion: 1.0, moraDiariaDefault: 0.5 };
  if (cfg) {
    await prisma.config.update({ where: { id: cfg.id }, data });
  } else {
    await prisma.config.create({ data: { tasaAnualDefault: 1.5, ...data } });
  }
  console.log('⚙️  Config: moraDiariaPlan=0.5%  moraDiariaNegociacion=1.0%');
}

// ============================================================
// A) Cliente con plan ACTIVO y cuotas vencidas → mora de PLAN
// ============================================================
async function crearClientePlanVencido() {
  const cli = await prisma.client.create({
    data: { nombre: 'SEED Plan Vencido', apellido: 'Test', dni: '90000001', localidad: 'Córdoba', telefonoCelular: '3510000001' },
  });
  const monto = 200000;
  const plan = await prisma.installmentPlan.create({
    data: { clientId: cli.id, totalCuotas: 10, montoCuotaBase: monto, fechaInicio: monthsAgo(3), estado: 'ACTIVO', numeroSolicitud: 'SEED-A' },
  });

  // 2 pagadas, 2 vencidas impagas/parciales, resto futuras.
  const cuotas = [
    { numero: 1, venc: monthsAgo(3), pagado: monto, estado: 'PAGADO' },
    { numero: 2, venc: monthsAgo(2), pagado: monto, estado: 'PAGADO' },
    { numero: 3, venc: daysAgo(40), pagado: 0, estado: 'PENDIENTE' },      // vencida → mora
    { numero: 4, venc: daysAgo(10), pagado: 100000, estado: 'PARCIAL' },   // vencida parcial → mora sobre 100k
  ];
  for (let i = 5; i <= 10; i++) cuotas.push({ numero: i, venc: daysFromNow((i - 4) * 30), pagado: 0, estado: 'PENDIENTE' });

  let moraEsperada = 0;
  for (const c of cuotas) {
    await prisma.installment.create({
      data: {
        planId: plan.id, numero: c.numero, fechaVencimiento: c.venc,
        monto, cargos: 0, cargosDetalle: mkCargos(), total: monto,
        pagado: c.pagado, estado: c.estado,
      },
    });
    const d = diasAtraso(c.venc);
    const restante = Math.max(monto - c.pagado, 0);
    if (d > 0 && c.estado !== 'PAGADO' && restante > 0) moraEsperada += restante * (0.5 / 100) * d;
  }
  console.log(`✅ A) Cliente #${cli.id} "SEED Plan Vencido" — plan ACTIVO. Mora de plan esperada ≈ $${round(moraEsperada).toLocaleString('es-AR')}`);
  return cli.id;
}

// ============================================================
// B) Cliente con plan PAGADO + negociación + SALDO vencido → mora de NEGOCIACIÓN
// ============================================================
async function crearClienteSaldoNegociado() {
  const cli = await prisma.client.create({
    data: { nombre: 'SEED Saldo Negociado', apellido: 'Test', dni: '90000002', localidad: 'Córdoba', telefonoCelular: '3510000002' },
  });
  const montoCuotaPlan = 150000;
  const fechaInicio = monthsAgo(8);
  const saldoMontoCuota = 200000;

  const plan = await prisma.installmentPlan.create({
    data: {
      clientId: cli.id, totalCuotas: 6, montoCuotaBase: montoCuotaPlan, fechaInicio, estado: 'RESUELTO',
      numeroSolicitud: 'SEED-B',
      // Negociación / retiro de auto
      resultadoVehiculo: 'AUTO', fechaResolucion: monthsAgo(3),
      vehiculoMarca: 'Toyota', vehiculoModelo: 'Corolla', vehiculoAnio: 2018, vehiculoPatente: 'AB123CD',
      // Etapa saldo iniciada
      saldoIniciado: true, fechaEntregaAuto: monthsAgo(3), saldoTotalCuotas: 5, saldoMontoCuota,
    },
  });

  // Plan pagado por completo (6 cuotas PAGADAS).
  for (let i = 1; i <= 6; i++) {
    await prisma.installment.create({
      data: {
        planId: plan.id, numero: i, fechaVencimiento: addMonths(fechaInicio, i),
        monto: montoCuotaPlan, cargos: 0, cargosDetalle: mkCargos(), total: montoCuotaPlan,
        pagado: montoCuotaPlan, estado: 'PAGADO',
      },
    });
  }

  // Cuotas de SALDO: 2 vencidas (mora de negociación), 3 futuras.
  const cuotasSaldo = [
    { numero: 1, venc: daysAgo(50), pagado: 0, estado: 'PENDIENTE' },      // vencida → mora
    { numero: 2, venc: daysAgo(20), pagado: 100000, estado: 'PARCIAL' },   // vencida parcial → mora sobre 100k
    { numero: 3, venc: daysFromNow(10), pagado: 0, estado: 'PENDIENTE' },
    { numero: 4, venc: daysFromNow(40), pagado: 0, estado: 'PENDIENTE' },
    { numero: 5, venc: daysFromNow(70), pagado: 0, estado: 'PENDIENTE' },
  ];
  let moraEsperada = 0;
  for (const c of cuotasSaldo) {
    await prisma.saldoCuota.create({
      data: {
        planId: plan.id, clientId: cli.id, numero: c.numero, fechaVencimiento: c.venc,
        monto: saldoMontoCuota, pagado: c.pagado, estado: c.estado,
      },
    });
    const d = diasAtraso(c.venc);
    const restante = Math.max(saldoMontoCuota - c.pagado, 0);
    if (d > 0 && c.estado !== 'PAGADO' && restante > 0) moraEsperada += restante * (1.0 / 100) * d;
  }
  console.log(`✅ B) Cliente #${cli.id} "SEED Saldo Negociado" — plan PAGADO + SALDO. Mora de saldo esperada ≈ $${round(moraEsperada).toLocaleString('es-AR')}`);
  return cli.id;
}

async function main() {
  const clean = process.argv.includes('--clean');
  console.log('🌱 Seed de mora — limpiando datos previos...');
  await limpiarSeedPrevio();
  if (clean) { console.log('🧼 Limpieza completa (--clean). No se crea nada nuevo.'); return; }

  await setTasasMora();
  await crearClientePlanVencido();
  await crearClienteSaldoNegociado();
  console.log('\n🎉 Listo. Refrescá el frontend. Vas a ver la mora de plan en el primer cliente y la mora de saldo en el segundo.');
  console.log('   (Si volvés a guardar la Configuración desde la UI, respetá moraDiariaNegociacion > 0 para seguir viendo mora de saldo.)');
}

main()
  .catch((e) => { console.error('❌ Error en el seed:', e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
