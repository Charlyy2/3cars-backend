-- "Pago abierto": permite que un plan siga sumando cuotas mensuales tras la cuota objetivo.
ALTER TABLE "installment_plans" ADD COLUMN "pagoAbierto" BOOLEAN NOT NULL DEFAULT false;
