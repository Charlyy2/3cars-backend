/*
  Warnings:

  - Added the required column `total` to the `installments` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "vehicles" DROP CONSTRAINT "vehicles_clientId_fkey";

-- AlterTable
ALTER TABLE "config" ADD COLUMN     "comisionPorcentaje" DOUBLE PRECISION NOT NULL DEFAULT 10,
ADD COLUMN     "gastoAdminFijo" DOUBLE PRECISION NOT NULL DEFAULT 5,
ADD COLUMN     "gastoRetiroPorcentaje" DOUBLE PRECISION NOT NULL DEFAULT 5,
ADD COLUMN     "selladoFijo" DOUBLE PRECISION NOT NULL DEFAULT 3;

-- AlterTable
ALTER TABLE "installments" ADD COLUMN     "cargos" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "total" DOUBLE PRECISION NOT NULL;

-- AlterTable
ALTER TABLE "vehicles" ADD COLUMN     "disponible" BOOLEAN NOT NULL DEFAULT true,
ALTER COLUMN "clientId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;
