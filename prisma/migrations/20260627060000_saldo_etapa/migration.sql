-- Plan: datos del vehículo retirado + archivos + etapa SALDO
ALTER TABLE "installment_plans" ADD COLUMN "vehiculoMarca" TEXT;
ALTER TABLE "installment_plans" ADD COLUMN "vehiculoModelo" TEXT;
ALTER TABLE "installment_plans" ADD COLUMN "vehiculoAnio" INTEGER;
ALTER TABLE "installment_plans" ADD COLUMN "vehiculoPatente" TEXT;
ALTER TABLE "installment_plans" ADD COLUMN "boletoCompraventa" TEXT;
ALTER TABLE "installment_plans" ADD COLUMN "contratoMutuo" TEXT;
ALTER TABLE "installment_plans" ADD COLUMN "saldoIniciado" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "installment_plans" ADD COLUMN "fechaEntregaAuto" TIMESTAMP(3);
ALTER TABLE "installment_plans" ADD COLUMN "saldoTotalCuotas" INTEGER;
ALTER TABLE "installment_plans" ADD COLUMN "saldoMontoCuota" DOUBLE PRECISION;

-- Payment: origen del pago (CUOTA | SALDO)
ALTER TABLE "payments" ADD COLUMN "origen" TEXT NOT NULL DEFAULT 'CUOTA';

-- PaymentAllocation: ahora installmentId es nullable y se agrega saldoCuotaId
ALTER TABLE "payment_allocations" ALTER COLUMN "installmentId" DROP NOT NULL;
ALTER TABLE "payment_allocations" ADD COLUMN "saldoCuotaId" INTEGER;

-- Tabla saldo_cuotas
CREATE TABLE "saldo_cuotas" (
    "id" SERIAL NOT NULL,
    "planId" INTEGER NOT NULL,
    "clientId" INTEGER NOT NULL,
    "numero" INTEGER NOT NULL,
    "fechaVencimiento" TIMESTAMP(3) NOT NULL,
    "monto" DOUBLE PRECISION NOT NULL,
    "pagado" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "estado" TEXT NOT NULL DEFAULT 'PENDIENTE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "saldo_cuotas_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "saldo_cuotas_planId_idx" ON "saldo_cuotas"("planId");
CREATE INDEX "saldo_cuotas_clientId_idx" ON "saldo_cuotas"("clientId");

-- FKs
ALTER TABLE "saldo_cuotas" ADD CONSTRAINT "saldo_cuotas_planId_fkey" FOREIGN KEY ("planId") REFERENCES "installment_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_saldoCuotaId_fkey" FOREIGN KEY ("saldoCuotaId") REFERENCES "saldo_cuotas"("id") ON DELETE SET NULL ON UPDATE CASCADE;
