/*
  Warnings:

  - You are about to drop the column `administrativoPct` on the `installment_plans` table. All the data in the column will be lost.
  - You are about to drop the column `cuotaObjetivoRetiro` on the `installment_plans` table. All the data in the column will be lost.
  - You are about to drop the column `retiroPct` on the `installment_plans` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "installment_plans" DROP COLUMN "administrativoPct",
DROP COLUMN "cuotaObjetivoRetiro",
DROP COLUMN "retiroPct";
