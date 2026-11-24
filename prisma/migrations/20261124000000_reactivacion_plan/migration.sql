-- Reactivación explícita de planes CAÍDOS + origen de la caída.
-- Migración 100% aditiva: agrega una columna NULLABLE (los planes existentes
-- quedan con motivoCaida = null = origen desconocido) y una tabla nueva.
-- No modifica cuotas, pagos, Caja ni estados existentes.

-- AlterTable
ALTER TABLE "installment_plans" ADD COLUMN     "motivoCaida" TEXT;

-- CreateTable
CREATE TABLE "plan_reactivaciones" (
    "id" SERIAL NOT NULL,
    "planId" INTEGER NOT NULL,
    "clientId" INTEGER NOT NULL,
    "motivo" TEXT NOT NULL,
    "motivoCaidaAnterior" TEXT,
    "origenConfirmado" BOOLEAN NOT NULL DEFAULT false,
    "cuotasVencidasImpagas" INTEGER NOT NULL,
    "deudaVencida" DOUBLE PRECISION NOT NULL,
    "versionVistaPrevia" TEXT,
    "createdById" INTEGER,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "plan_reactivaciones_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "plan_reactivaciones_planId_idx" ON "plan_reactivaciones"("planId");

-- AddForeignKey
ALTER TABLE "plan_reactivaciones" ADD CONSTRAINT "plan_reactivaciones_planId_fkey" FOREIGN KEY ("planId") REFERENCES "installment_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

