/*
  Warnings:

  - A unique constraint covering the columns `[numeroSolicitud]` on the table `installment_plans` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "installment_plans" ADD COLUMN     "administrativoPct" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "cuotaObjetivoRetiro" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "numeroSolicitud" TEXT,
ADD COLUMN     "retiroPct" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- CreateIndex
CREATE UNIQUE INDEX "installment_plans_numeroSolicitud_key" ON "installment_plans"("numeroSolicitud");
