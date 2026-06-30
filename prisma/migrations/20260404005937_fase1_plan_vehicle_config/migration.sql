-- AlterTable
ALTER TABLE "installment_plans" ADD COLUMN     "estado" TEXT NOT NULL DEFAULT 'VENTA_REALIZADA';

-- CreateTable
CREATE TABLE "vehicles" (
    "id" SERIAL NOT NULL,
    "clientId" INTEGER NOT NULL,
    "dominio" TEXT NOT NULL,
    "patente" TEXT NOT NULL,
    "modelo" TEXT NOT NULL,
    "anio" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vehicles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "config" (
    "id" SERIAL NOT NULL,
    "tasaAnualDefault" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "moraDiariaDefault" DOUBLE PRECISION NOT NULL DEFAULT 0,

    CONSTRAINT "config_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "vehicles_clientId_key" ON "vehicles"("clientId");

-- AddForeignKey
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
