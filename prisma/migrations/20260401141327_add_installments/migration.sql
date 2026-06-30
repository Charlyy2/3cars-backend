-- CreateTable
CREATE TABLE "installment_plans" (
    "id" SERIAL NOT NULL,
    "clientId" INTEGER NOT NULL,
    "totalCuotas" INTEGER NOT NULL,
    "montoCuota" DOUBLE PRECISION NOT NULL,
    "fechaInicio" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "installment_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "installments" (
    "id" SERIAL NOT NULL,
    "planId" INTEGER NOT NULL,
    "numero" INTEGER NOT NULL,
    "fechaVencimiento" TIMESTAMP(3) NOT NULL,
    "monto" DOUBLE PRECISION NOT NULL,
    "pagado" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "estado" TEXT NOT NULL DEFAULT 'PENDIENTE',

    CONSTRAINT "installments_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "installment_plans" ADD CONSTRAINT "installment_plans_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "installments" ADD CONSTRAINT "installments_planId_fkey" FOREIGN KEY ("planId") REFERENCES "installment_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
