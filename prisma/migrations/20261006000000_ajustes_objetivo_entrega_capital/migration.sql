-- Regularización del saldo objetivo (ajustes/condonaciones) + entrega de capital
-- con modalidad (DINERO | VEHICULO | MIXTA).
-- Migración 100% aditiva: no modifica ni borra datos existentes.
--  * installments.ajustado = 0 para todas las cuotas existentes (sin ajustes previos).
--  * Las entregas de capital históricas (resolucionDetalle / CashMovement ENTREGA_CAPITAL)
--    no se copian: se interpretan como DINERO al leerlas.

-- AlterTable
ALTER TABLE "installments" ADD COLUMN     "ajustado" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "plan_ajustes" (
    "id" SERIAL NOT NULL,
    "planId" INTEGER NOT NULL,
    "installmentId" INTEGER,
    "clientId" INTEGER NOT NULL,
    "tipo" TEXT NOT NULL,
    "monto" DOUBLE PRECISION NOT NULL,
    "motivo" TEXT NOT NULL,
    "estado" TEXT NOT NULL DEFAULT 'ACTIVO',
    "createdById" INTEGER,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "anuladoAt" TIMESTAMP(3),
    "anuladoById" INTEGER,
    "anuladoBy" TEXT,
    "motivoAnulacion" TEXT,

    CONSTRAINT "plan_ajustes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "entregas_capital" (
    "id" SERIAL NOT NULL,
    "planId" INTEGER NOT NULL,
    "clientId" INTEGER NOT NULL,
    "tipoEntrega" TEXT NOT NULL DEFAULT 'DINERO',
    "montoDinero" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "vehiculoValorToma" DOUBLE PRECISION,
    "vehiculoPatente" TEXT,
    "vehiculoAnio" INTEGER,
    "vehiculoMarca" TEXT,
    "vehiculoModelo" TEXT,
    "vehiculoObservaciones" TEXT,
    "valorTotal" DOUBLE PRECISION NOT NULL,
    "comisionPct" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "comisionMonto" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "cashMovementId" INTEGER,
    "observacion" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "entregas_capital_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "plan_ajustes_planId_idx" ON "plan_ajustes"("planId");

-- CreateIndex
CREATE INDEX "plan_ajustes_installmentId_idx" ON "plan_ajustes"("installmentId");

-- CreateIndex
CREATE UNIQUE INDEX "entregas_capital_cashMovementId_key" ON "entregas_capital"("cashMovementId");

-- CreateIndex
CREATE INDEX "entregas_capital_planId_idx" ON "entregas_capital"("planId");

-- AddForeignKey
ALTER TABLE "plan_ajustes" ADD CONSTRAINT "plan_ajustes_planId_fkey" FOREIGN KEY ("planId") REFERENCES "installment_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_ajustes" ADD CONSTRAINT "plan_ajustes_installmentId_fkey" FOREIGN KEY ("installmentId") REFERENCES "installments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_ajustes" ADD CONSTRAINT "plan_ajustes_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entregas_capital" ADD CONSTRAINT "entregas_capital_planId_fkey" FOREIGN KEY ("planId") REFERENCES "installment_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entregas_capital" ADD CONSTRAINT "entregas_capital_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entregas_capital" ADD CONSTRAINT "entregas_capital_cashMovementId_fkey" FOREIGN KEY ("cashMovementId") REFERENCES "cash_movements"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Defensa en base: un ajuste o una entrega nunca pueden ser negativos.
ALTER TABLE "plan_ajustes" ADD CONSTRAINT "plan_ajustes_monto_positive" CHECK ("monto" > 0);
ALTER TABLE "entregas_capital" ADD CONSTRAINT "entregas_capital_montos_non_negative"
  CHECK ("montoDinero" >= 0 AND "valorTotal" > 0 AND ("vehiculoValorToma" IS NULL OR "vehiculoValorToma" > 0));
