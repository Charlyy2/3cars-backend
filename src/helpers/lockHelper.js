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

module.exports = { lockPlan, lockClientOpenPlans };
