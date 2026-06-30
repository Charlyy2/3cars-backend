/*
  Warnings:

  - You are about to drop the column `entregaInicial` on the `financing` table. All the data in the column will be lost.
  - You are about to drop the column `fechaInicio` on the `financing` table. All the data in the column will be lost.
  - You are about to drop the column `precioTotal` on the `financing` table. All the data in the column will be lost.
  - You are about to drop the column `saldo` on the `financing` table. All the data in the column will be lost.
  - You are about to drop the column `saldoFinanciado` on the `financing` table. All the data in the column will be lost.
  - You are about to drop the column `montoCuota` on the `installment_plans` table. All the data in the column will be lost.
  - You are about to drop the column `precioTotal` on the `installment_plans` table. All the data in the column will be lost.
  - You are about to drop the column `selladoPct` on the `installment_plans` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[planId]` on the table `financing` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `cuotasPagadas` to the `financing` table without a default value. This is not possible if the table is not empty.
  - Added the required column `montoPagado` to the `financing` table without a default value. This is not possible if the table is not empty.
  - Added the required column `montoRetiro` to the `financing` table without a default value. This is not possible if the table is not empty.
  - Added the required column `planId` to the `financing` table without a default value. This is not possible if the table is not empty.
  - Added the required column `precioVehiculo` to the `financing` table without a default value. This is not possible if the table is not empty.
  - Added the required column `saldoInicial` to the `financing` table without a default value. This is not possible if the table is not empty.
  - Added the required column `vehicleId` to the `financing` table without a default value. This is not possible if the table is not empty.
  - Added the required column `montoCuotaBase` to the `installment_plans` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "financing" DROP COLUMN "entregaInicial",
DROP COLUMN "fechaInicio",
DROP COLUMN "precioTotal",
DROP COLUMN "saldo",
DROP COLUMN "saldoFinanciado",
ADD COLUMN     "cuotasPagadas" INTEGER NOT NULL,
ADD COLUMN     "fechaCreacion" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "montoPagado" DOUBLE PRECISION NOT NULL,
ADD COLUMN     "montoRetiro" DOUBLE PRECISION NOT NULL,
ADD COLUMN     "planId" INTEGER NOT NULL,
ADD COLUMN     "precioVehiculo" DOUBLE PRECISION NOT NULL,
ADD COLUMN     "saldoInicial" DOUBLE PRECISION NOT NULL,
ADD COLUMN     "vehicleId" INTEGER NOT NULL;

-- AlterTable
ALTER TABLE "installment_plans" DROP COLUMN "montoCuota",
DROP COLUMN "precioTotal",
DROP COLUMN "selladoPct",
ADD COLUMN     "cuotaObjetivoRetiro" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "cuotasConSellado" INTEGER NOT NULL DEFAULT 2,
ADD COLUMN     "fechaRetiro" TIMESTAMP(3),
ADD COLUMN     "montoCuotaBase" DOUBLE PRECISION NOT NULL,
ADD COLUMN     "montoRetiro" DOUBLE PRECISION,
ADD COLUMN     "saldoAlRetiro" DOUBLE PRECISION,
ADD COLUMN     "selladoMonto" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "vehicleId" INTEGER,
ALTER COLUMN "estado" SET DEFAULT 'ACTIVO';

-- AlterTable
ALTER TABLE "vehicles" ADD COLUMN     "precio" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- CreateIndex
CREATE UNIQUE INDEX "financing_planId_key" ON "financing"("planId");

-- AddForeignKey
ALTER TABLE "installment_plans" ADD CONSTRAINT "installment_plans_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "vehicles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financing" ADD CONSTRAINT "financing_planId_fkey" FOREIGN KEY ("planId") REFERENCES "installment_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financing" ADD CONSTRAINT "financing_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "vehicles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
