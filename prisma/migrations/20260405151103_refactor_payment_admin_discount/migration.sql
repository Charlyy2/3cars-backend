/*
  Warnings:

  - You are about to drop the column `monto` on the `payments` table. All the data in the column will be lost.
  - Added the required column `montoAplicado` to the `payments` table without a default value. This is not possible if the table is not empty.
  - Added the required column `montoTotal` to the `payments` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "payments" DROP COLUMN "monto",
ADD COLUMN     "montoAdmin" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "montoAplicado" DOUBLE PRECISION NOT NULL,
ADD COLUMN     "montoTotal" DOUBLE PRECISION NOT NULL;
