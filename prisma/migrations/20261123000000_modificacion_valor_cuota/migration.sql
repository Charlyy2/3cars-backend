-- Modificación del valor de cuota: historial / auditoría.
-- Migración 100% aditiva: solo crea una tabla nueva. No modifica ni borra
-- datos ni columnas existentes (installments / installment_plans no cambian
-- de estructura).

-- CreateTable
CREATE TABLE "plan_modificaciones_cuota" (
    "id" SERIAL NOT NULL,
    "planId" INTEGER NOT NULL,
    "clientId" INTEGER NOT NULL,
    "montoAnteriorPlan" DOUBLE PRECISION NOT NULL,
    "montoNuevo" DOUBLE PRECISION NOT NULL,
    "cuotasAfectadas" INTEGER NOT NULL,
    "deudaAnterior" DOUBLE PRECISION NOT NULL,
    "deudaNueva" DOUBLE PRECISION NOT NULL,
    "variacionDeuda" DOUBLE PRECISION NOT NULL,
    "motivo" TEXT NOT NULL,
    "detalle" JSONB NOT NULL,
    "objetivo" JSONB,
    "versionVistaPrevia" TEXT,
    "createdById" INTEGER,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "plan_modificaciones_cuota_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "plan_modificaciones_cuota_planId_idx" ON "plan_modificaciones_cuota"("planId");

-- AddForeignKey
ALTER TABLE "plan_modificaciones_cuota" ADD CONSTRAINT "plan_modificaciones_cuota_planId_fkey" FOREIGN KEY ("planId") REFERENCES "installment_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

