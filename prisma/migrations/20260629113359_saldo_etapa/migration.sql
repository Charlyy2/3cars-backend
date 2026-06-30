-- DropForeignKey
ALTER TABLE "payment_allocations" DROP CONSTRAINT "payment_allocations_installmentId_fkey";

-- DropIndex
DROP INDEX "saldo_cuotas_clientId_idx";

-- DropIndex
DROP INDEX "saldo_cuotas_planId_idx";

-- AddForeignKey
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_installmentId_fkey" FOREIGN KEY ("installmentId") REFERENCES "installments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
