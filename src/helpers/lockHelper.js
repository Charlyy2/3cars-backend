/**
 * Locks pesimistas (PostgreSQL SELECT ... FOR UPDATE) para serializar las
 * operaciones que leen y modifican la deuda de un plan: ajustes del objetivo,
 * pagos y negociación. Deben llamarse DENTRO de un prisma.$transaction y ANTES
 * de leer las cuotas, así cada operación ve el estado ya confirmado por la otra.
 */

const lockPlan = async (tx, planId) => {
  await tx.$queryRaw`SELECT id FROM installment_plans WHERE id = ${parseInt(planId)} FOR UPDATE`;
};

// Planes de un cliente que todavía están en circuito de cobranza.
const lockClientOpenPlans = async (tx, clientId) => {
  await tx.$queryRaw`
    SELECT id FROM installment_plans
    WHERE "clientId" = ${parseInt(clientId)} AND estado IN ('ACTIVO', 'NEGOCIACION')
    ORDER BY id
    FOR UPDATE`;
};

/**
 * Lock compartido POR CLIENTE para las operaciones que pueden dejar un plan
 * vigente (ACTIVO / NEGOCIACION): crear un plan y reactivar uno CAIDO. Serializa
 * esas operaciones entre sí para que siempre haya como máximo un plan vigente.
 *
 * FOR NO KEY UPDATE (y no FOR UPDATE): no bloquea los INSERT con FK a clients
 * (pagos, planes, movimientos), que toman FOR KEY SHARE. Así un pago dirigido que
 * ya tiene el lock del plan no queda esperando a una reactivación que a su vez
 * espera ese plan (evita el deadlock). Orden: SIEMPRE cliente → plan.
 */
const lockClient = async (tx, clientId) => {
  await tx.$queryRaw`SELECT id FROM clients WHERE id = ${parseInt(clientId)} FOR NO KEY UPDATE`;
};

// Estados en los que un plan es "vigente": como máximo uno por cliente.
const ESTADOS_PLAN_VIGENTE = ['ACTIVO', 'NEGOCIACION'];

/** Otro plan vigente del cliente (llamar con lockClient tomado). */
const buscarPlanVigente = (tx, clientId, exceptoPlanId = null) =>
  tx.installmentPlan.findFirst({
    where: {
      clientId: parseInt(clientId),
      estado: { in: ESTADOS_PLAN_VIGENTE },
      ...(exceptoPlanId ? { id: { not: parseInt(exceptoPlanId) } } : {}),
    },
    select: { id: true, estado: true },
    orderBy: { id: 'asc' },
  });

module.exports = { lockPlan, lockClientOpenPlans, lockClient, ESTADOS_PLAN_VIGENTE, buscarPlanVigente };
