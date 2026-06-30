-- AlterTable: Config — flag para incluir sellado en comisión
ALTER TABLE "config" ADD COLUMN     "includeSealInCommission" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable: categorías de movimientos de caja
CREATE TABLE "cash_movement_categories" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "system" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "cash_movement_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable: movimientos de caja (única fuente de verdad)
-- El tipo (INGRESO|EGRESO) NO se almacena: lo aporta la categoría (category.type).
CREATE TABLE "cash_movements" (
    "id" SERIAL NOT NULL,
    "categoryId" INTEGER NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "description" TEXT,
    "origin" TEXT NOT NULL DEFAULT 'MANUAL',
    "paymentId" INTEGER,
    "clientId" INTEGER,
    "installmentId" INTEGER,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cash_movements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "cash_movement_categories_name_key" ON "cash_movement_categories"("name");
CREATE INDEX "cash_movements_origin_idx" ON "cash_movements"("origin");
CREATE INDEX "cash_movements_categoryId_idx" ON "cash_movements"("categoryId");
CREATE INDEX "cash_movements_clientId_idx" ON "cash_movements"("clientId");
CREATE INDEX "cash_movements_createdAt_idx" ON "cash_movements"("createdAt");

-- AddForeignKey
ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "cash_movement_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_installmentId_fkey" FOREIGN KEY ("installmentId") REFERENCES "installments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Seed: categorías iniciales del sistema (system = true, no eliminables)
INSERT INTO "cash_movement_categories" ("name", "type", "system") VALUES
    ('COBRO_CUOTA', 'INGRESO', true),
    ('ENTREGA_CAPITAL', 'INGRESO', true),
    ('GASTO_RETIRO', 'INGRESO', true),
    ('SELLADO', 'INGRESO', true),
    ('OTROS', 'INGRESO', true),
    ('COMISION_CUOTA', 'EGRESO', true),
    ('COMBUSTIBLE', 'EGRESO', true),
    ('HOSPEDAJE', 'EGRESO', true),
    ('PEAJE', 'EGRESO', true),
    ('VIATICOS', 'EGRESO', true),
    ('LIBRERIA', 'EGRESO', true),
    ('ESTUDIO_JURIDICO', 'EGRESO', true),
    ('ESTUDIO_CONTABLE', 'EGRESO', true),
    ('ALQUILER', 'EGRESO', true),
    ('SERVICIOS', 'EGRESO', true),
    ('IMPUESTOS', 'EGRESO', true),
    ('ADQUISICION_VEHICULO', 'EGRESO', true),
    ('DEVOLUCIONES', 'EGRESO', true),
    ('GARANTIAS', 'EGRESO', true),
    ('GASTOS_ADMINISTRATIVOS', 'EGRESO', true),
    ('SUELDOS', 'EGRESO', true),
    ('GASTOS_VARIOS', 'EGRESO', true);
