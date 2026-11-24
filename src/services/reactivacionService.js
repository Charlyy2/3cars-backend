const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const { lockPlan, lockClient, ESTADOS_PLAN_VIGENTE } = require('../helpers/lockHelper');
const { roundCurrency, deudaEfectivaCuota } = require('../helpers/objetivoHelper');
const { UMBRAL_CAIDA, contarVencidasImpagas } = require('./installmentService');
const { huellaDatos, sha256 } = require('./modificacionCuotaService');

/**
 * REACTIVAR PLAN (CAIDO → ACTIVO), acción explícita e independiente.
 *
 * Distingue tres cosas:
 *  - reducción del valor de cuotas  → modificacionCuotaService (no cambia estado);
 *  - cobro de obligaciones vencidas  → pago con planId de destino (el plan sigue CAIDO);
 *  - reactivación efectiva          → este servicio.
 *
 * Regla: solo se reactiva si quedan MENOS de UMBRAL_CAIDA (3) cuotas vencidas
 * impagas, contadas con la MISMA función que usa la caída automática. Así el plan
 * reactivado no vuelve a caer en la próxima consulta. No es un pago ni un ajuste:
 * no crea Payment / PaymentAllocation / PlanAjuste / CashMovement, no cambia
 * vencimientos ni condona deuda. Queda auditado en PlanReactivacion.
 *
 * Origen de la caída (InstallmentPlan.motivoCaida):
 *  - MORA_AUTOMATICA → se reactiva sin advertencia adicional;
 *  - BAJA_MANUAL     → advertencia + confirmación explícita (revierte una baja deliberada);
 *  - null            → caída anterior al registro del origen: no se puede saber si
 *                      fue mora o baja manual → advertencia + confirmación explícita.
 */

const ESTADOS_IMPAGOS = ['PENDIENTE', 'PARCIAL'];

const fmt = (v) => `$${Number(v || 0).toLocaleString('es-AR', { maximumFractionDigits: 2 })}`;

const advertenciaOrigen = (motivoCaida) => {
  if (motivoCaida === 'MORA_AUTOMATICA') return null;
  if (motivoCaida === 'BAJA_MANUAL') {
    return 'Este plan fue dado de baja manualmente desde el backoffice. Reactivarlo revierte esa decisión.';
  }
  return 'No se puede determinar si este plan cayó por mora o fue dado de baja manualmente (la caída es anterior al registro de su origen). Verificá el motivo antes de reactivarlo.';
};

const getPlanConCuotas = (db, planId) =>
  db.installmentPlan.findUnique({
    where: { id: parseInt(planId) },
    include: { installments: { orderBy: { numero: 'asc' } } },
  });

const otrosPlanesVigentes = (db, plan) =>
  db.installmentPlan.findMany({
    where: { clientId: plan.clientId, id: { not: plan.id }, estado: { in: ESTADOS_PLAN_VIGENTE } },
    select: { id: true, estado: true },
    orderBy: { id: 'asc' },
  });

/**
 * Cálculo PURO del estado de reactivación.
 * El importe mínimo sale del orden real de imputación de los pagos (vencimiento,
 * número): para quedar por debajo del umbral hay que saldar las cuotas vencidas
 * más antiguas por su deuda efectiva (total - pagado - ajustado).
 */
const calcularReactivacion = (plan, installments, otros = [], ahora = new Date()) => {
  const vencidas = installments
    .filter((c) => ESTADOS_IMPAGOS.includes(c.estado) && new Date(c.fechaVencimiento) < ahora)
    .sort((a, b) => (new Date(a.fechaVencimiento) - new Date(b.fechaVencimiento)) || (a.numero - b.numero));

  const n = vencidas.length;
  const cuotasARegularizar = Math.max(0, n - (UMBRAL_CAIDA - 1));
  const detalle = vencidas.slice(0, cuotasARegularizar).map((c) => ({
    numero: c.numero, fechaVencimiento: c.fechaVencimiento, deuda: deudaEfectivaCuota(c),
  }));
  const montoMinimo = roundCurrency(detalle.reduce((s, d) => s + d.deuda, 0));
  const deudaVencida = roundCurrency(vencidas.reduce((s, c) => s + deudaEfectivaCuota(c), 0));
  const otroPlanVigente = otros[0] || null;
  const esCaido = plan.estado === 'CAIDO';
  const advertencia = esCaido ? advertenciaOrigen(plan.motivoCaida) : null;

  let motivoBloqueo = null;
  if (!esCaido) motivoBloqueo = `El plan está en estado ${plan.estado}: solo se puede reactivar un plan CAÍDO.`;
  else if (otroPlanVigente) motivoBloqueo = `El cliente ya tiene otro plan vigente (#${otroPlanVigente.id}, ${otroPlanVigente.estado}).`;
  else if (n >= UMBRAL_CAIDA) {
    motivoBloqueo = `Tiene ${n} cuotas vencidas impagas. Para reactivar debe regularizar ${cuotasARegularizar} cuota(s): importe mínimo ${fmt(montoMinimo)}.`;
  }

  return {
    planId: plan.id,
    estadoPlan: plan.estado,
    esCaido,
    motivoCaida: plan.motivoCaida || null,
    requiereConfirmacionOrigen: !!advertencia,
    advertenciaOrigen: advertencia,
    umbral: UMBRAL_CAIDA,
    cuotasVencidasImpagas: n,
    deudaVencida,
    cuotasARegularizar,
    cuotasARegularizarDetalle: detalle,
    montoMinimo,
    otroPlanVigente,
    puedeReactivar: !motivoBloqueo,
    motivoBloqueo,
    // Mismos datos que la modificación de cuotas + origen de la caída + otros planes vigentes.
    versionVistaPrevia: sha256({
      datos: huellaDatos(plan, installments),
      motivoCaida: plan.motivoCaida || null,
      otros: otros.map((o) => [o.id, o.estado]),
      accion: 'REACTIVAR',
    }),
  };
};

const previsualizar = async (planId) => {
  const plan = await getPlanConCuotas(prisma, planId);
  if (!plan) throw new Error('PLAN_NOT_FOUND');
  const otros = await otrosPlanesVigentes(prisma, plan);
  return calcularReactivacion(plan, plan.installments, otros);
};

const rechazar = (code, calc) => {
  const err = new Error(code);
  err.preview = calc;
  return err;
};

/**
 * @param {object} data - { motivo, versionVistaPrevia, confirmaOrigenCaida, user: { id, username } }
 */
const reactivarPlan = async (planId, { motivo, versionVistaPrevia, confirmaOrigenCaida, user } = {}) => {
  const parsedPlanId = parseInt(planId);
  const motivoNorm = String(motivo || '').trim();
  if (!motivoNorm) throw new Error('MOTIVO_REQUERIDO');
  const version = String(versionVistaPrevia || '').trim();
  if (!/^[0-9a-f]{64}$/.test(version)) throw new Error('VERSION_REQUERIDA');

  // clientId no cambia nunca: se lee antes para poder tomar el lock del cliente.
  const ref = await prisma.installmentPlan.findUnique({ where: { id: parsedPlanId }, select: { clientId: true } });
  if (!ref) throw new Error('PLAN_NOT_FOUND');

  return prisma.$transaction(async (tx) => {
    // 1) Lock del CLIENTE: serializa con la creación de planes y otras
    //    reactivaciones del mismo cliente (un solo plan vigente).
    // 2) Lock del PLAN: serializa con pagos dirigidos y modificaciones de cuota.
    // Orden fijo cliente → plan. Todo se lee DESPUÉS de los locks.
    await lockClient(tx, ref.clientId);
    await lockPlan(tx, parsedPlanId);
    const plan = await getPlanConCuotas(tx, parsedPlanId);
    if (!plan) throw new Error('PLAN_NOT_FOUND');
    if (plan.estado !== 'CAIDO') throw new Error('PLAN_NO_CAIDO');

    const ahora = new Date();
    const otros = await otrosPlanesVigentes(tx, plan);
    const calc = calcularReactivacion(plan, plan.installments, otros, ahora);
    if (calc.versionVistaPrevia !== version) throw rechazar('VISTA_PREVIA_DESACTUALIZADA', calc);
    if (calc.otroPlanVigente) throw rechazar('OTRO_PLAN_VIGENTE', calc);

    // Decisión con la MISMA consulta que usa la caída automática.
    const vencidas = await contarVencidasImpagas(tx, parsedPlanId, ahora);
    if (vencidas >= UMBRAL_CAIDA) throw rechazar('REACTIVACION_NO_CUMPLE', calc);
    if (calc.requiereConfirmacionOrigen && confirmaOrigenCaida !== true) {
      throw rechazar('CONFIRMACION_ORIGEN_REQUERIDA', calc);
    }

    const res = await tx.installmentPlan.updateMany({
      where: { id: parsedPlanId, estado: 'CAIDO' },
      data: { estado: 'ACTIVO', motivoCaida: null },
    });
    if (res.count !== 1) throw new Error('PLAN_NO_CAIDO');

    const reactivacion = await tx.planReactivacion.create({
      data: {
        planId: parsedPlanId,
        clientId: plan.clientId,
        motivo: motivoNorm,
        motivoCaidaAnterior: plan.motivoCaida || null,
        origenConfirmado: calc.requiereConfirmacionOrigen,
        cuotasVencidasImpagas: vencidas,
        deudaVencida: calc.deudaVencida,
        versionVistaPrevia: version,
        createdById: user?.id || null,
        createdBy: user?.username || null,
      },
    });

    return { reactivacion, plan: await tx.installmentPlan.findUnique({ where: { id: parsedPlanId } }) };
  });
};

module.exports = { calcularReactivacion, previsualizar, reactivarPlan };
