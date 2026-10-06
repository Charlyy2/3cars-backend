const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const { lockPlan } = require('../helpers/lockHelper');
const {
  EPS,
  TIPOS_AJUSTE,
  roundCurrency,
  ajustableCuota,
  composicionCuota,
  estadoCuota,
  evaluarObjetivo,
} = require('../helpers/objetivoHelper');

/**
 * AJUSTES DEL OBJETIVO (regularización / condonación del saldo objetivo).
 *
 * Un ajuste NO es un pago ni dinero:
 *  - no crea Payment, PaymentAllocation ni CashMovement (Caja no cambia);
 *  - no modifica Installment.pagado ni el total/objetivo original;
 *  - solo suma a Installment.ajustado y recalcula el estado de la cuota
 *    (REGULARIZADA si queda cubierta con dinero + ajustes).
 * Los ajustes nunca se borran: se anulan (estado ANULADO, quién/cuándo/por qué).
 *
 * Solo se ajusta el IMPORTE de la cuota (base + mora). Sellado y gasto de retiro
 * no se condonan ni se marcan cobrados por un ajuste: siguen siendo deuda hasta
 * que se paguen con dinero.
 *
 * Invariante del caché: Installment.ajustado = Σ monto de los PlanAjuste ACTIVOS
 * con ese installmentId. Se mantiene en la misma transacción (con lock del plan)
 * que crea/anula el ajuste, y puede reconstruirse en cualquier momento con:
 *   UPDATE installments i SET ajustado = COALESCE((SELECT SUM(a.monto)
 *     FROM plan_ajustes a WHERE a."installmentId" = i.id AND a.estado = 'ACTIVO'), 0);
 */

const getPlanConCuotas = (db, planId) =>
  db.installmentPlan.findUnique({
    where: { id: parseInt(planId) },
    include: { installments: { orderBy: { numero: 'asc' } } },
  });

const getObjetivo = async (planId) => {
  const plan = await getPlanConCuotas(prisma, planId);
  if (!plan) throw new Error('PLAN_NOT_FOUND');
  return evaluarObjetivo(plan, plan.installments);
};

/**
 * Registra un ajuste sobre el saldo pendiente del objetivo.
 * Se reparte sobre las cuotas del objetivo con deuda efectiva, en orden.
 * Serializado por plan (FOR UPDATE): dos ajustes simultáneos no pueden
 * superar entre ambos el saldo pendiente.
 *
 * @param {number} planId
 * @param {object} data - { tipo, monto, motivo, user: { id, username } }
 */
const crearAjuste = async (planId, { tipo, monto, motivo, user } = {}) => {
  const parsedPlanId = parseInt(planId);
  const tipoNorm = String(tipo || '').trim().toUpperCase();
  const motivoNorm = String(motivo || '').trim();
  const amount = roundCurrency(monto);

  if (!TIPOS_AJUSTE.includes(tipoNorm)) throw new Error('INVALID_AJUSTE_TIPO');
  if (!motivoNorm) throw new Error('AJUSTE_MOTIVO_REQUERIDO');
  if (!Number.isFinite(Number(monto)) || !(amount > 0)) throw new Error('INVALID_AMOUNT');

  return prisma.$transaction(async (tx) => {
    await lockPlan(tx, parsedPlanId);
    const plan = await getPlanConCuotas(tx, parsedPlanId);
    if (!plan) throw new Error('PLAN_NOT_FOUND');
    if (plan.estado !== 'ACTIVO') throw new Error('PLAN_NOT_ACTIVE');

    const antes = evaluarObjetivo(plan, plan.installments);
    if (!antes.tieneObjetivo) throw new Error('PLAN_SIN_OBJETIVO');
    // El objetivo se mide sobre la cuota/base: si está cubierto, no hay nada que
    // ajustar aunque queden cargos (los cargos nunca se ajustan).
    if (antes.saldoPendienteEfectivo <= EPS) throw new Error('OBJETIVO_YA_CUMPLIDO');
    if (amount > antes.ajustableMaximo + EPS) {
      const err = new Error('AJUSTE_EXCEDE_SALDO');
      err.saldoPendienteEfectivo = antes.ajustableMaximo;
      throw err;
    }

    const cuotasObjetivo = plan.installments.filter((c) => c.numero <= antes.cuotaObjetivo);
    let restante = amount;
    const ajustes = [];

    for (const cuota of cuotasObjetivo) {
      if (restante <= EPS) break;
      const deuda = ajustableCuota(cuota);
      if (deuda <= EPS) continue;
      const aplicar = roundCurrency(Math.min(restante, deuda));

      ajustes.push(await tx.planAjuste.create({
        data: {
          planId: parsedPlanId,
          installmentId: cuota.id,
          clientId: plan.clientId,
          tipo: tipoNorm,
          monto: aplicar,
          motivo: motivoNorm,
          createdById: user?.id || null,
          createdBy: user?.username || null,
        },
      }));

      const nuevoAjustado = roundCurrency(Number(cuota.ajustado || 0) + aplicar);
      await tx.installment.update({
        where: { id: cuota.id },
        data: {
          ajustado: nuevoAjustado,
          estado: estadoCuota({ total: cuota.total, pagado: cuota.pagado, ajustado: nuevoAjustado }),
        },
      });
      restante = roundCurrency(restante - aplicar);
    }

    const actualizado = await getPlanConCuotas(tx, parsedPlanId);
    return { ajustes, objetivo: evaluarObjetivo(actualizado, actualizado.installments) };
  });
};

/**
 * Anula un ajuste (no lo borra). Solo mientras el plan siga ACTIVO: si ya se
 * negoció/resolvió apoyándose en ese ajuste, anularlo dejaría la negociación
 * sin respaldo.
 */
const anularAjuste = async (planId, ajusteId, { motivo, user } = {}) => {
  const parsedPlanId = parseInt(planId);
  const parsedAjusteId = parseInt(ajusteId);
  const motivoNorm = String(motivo || '').trim();
  if (!motivoNorm) throw new Error('ANULACION_MOTIVO_REQUERIDO');

  return prisma.$transaction(async (tx) => {
    await lockPlan(tx, parsedPlanId);
    const plan = await tx.installmentPlan.findUnique({ where: { id: parsedPlanId } });
    if (!plan) throw new Error('PLAN_NOT_FOUND');

    const ajuste = await tx.planAjuste.findUnique({ where: { id: parsedAjusteId } });
    if (!ajuste || ajuste.planId !== parsedPlanId) throw new Error('AJUSTE_NOT_FOUND');
    if (ajuste.estado === 'ANULADO') throw new Error('AJUSTE_YA_ANULADO');
    if (plan.estado !== 'ACTIVO') throw new Error('PLAN_NOT_ACTIVE');

    const anulado = await tx.planAjuste.update({
      where: { id: parsedAjusteId },
      data: {
        estado: 'ANULADO',
        anuladoAt: new Date(),
        anuladoById: user?.id || null,
        anuladoBy: user?.username || null,
        motivoAnulacion: motivoNorm,
      },
    });

    if (ajuste.installmentId) {
      const cuota = await tx.installment.findUnique({ where: { id: ajuste.installmentId } });
      const nuevoAjustado = Math.max(0, roundCurrency(Number(cuota.ajustado || 0) - ajuste.monto));
      // Si después del ajuste entró dinero que (por la cascada) fue a sellado /
      // gasto de retiro y ya está en Caja, anular lo movería de vuelta a la cuota
      // y Caja quedaría inconsistente. Se rechaza.
      const actual = composicionCuota(cuota);
      const sinAjuste = composicionCuota({ ...cuota, ajustado: nuevoAjustado });
      if (Math.abs(actual.selladoCobrado - sinAjuste.selladoCobrado) > EPS
        || Math.abs(actual.gastoRetiroCobrado - sinAjuste.gastoRetiroCobrado) > EPS
        || Math.abs(actual.otrosCobrado - sinAjuste.otrosCobrado) > EPS) {
        throw new Error('AJUSTE_CON_PAGOS_POSTERIORES');
      }
      await tx.installment.update({
        where: { id: cuota.id },
        data: {
          ajustado: nuevoAjustado,
          estado: estadoCuota({ total: cuota.total, pagado: cuota.pagado, ajustado: nuevoAjustado }),
        },
      });
    }

    const actualizado = await getPlanConCuotas(tx, parsedPlanId);
    return { ajuste: anulado, objetivo: evaluarObjetivo(actualizado, actualizado.installments) };
  });
};

const listarAjustes = async (planId) =>
  prisma.planAjuste.findMany({
    where: { planId: parseInt(planId) },
    include: { installment: { select: { numero: true } } },
    orderBy: { createdAt: 'desc' },
  });

module.exports = {
  getObjetivo,
  crearAjuste,
  anularAjuste,
  listarAjustes,
};
