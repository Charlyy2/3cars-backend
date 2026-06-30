-- AlterTable: flags de categoría (manual / requiere cliente)
ALTER TABLE "cash_movement_categories" ADD COLUMN     "isManual" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "cash_movement_categories" ADD COLUMN     "requiresClient" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable: datos de resolución del plan
ALTER TABLE "installment_plans" ADD COLUMN     "fechaResolucion" TIMESTAMP(3);
ALTER TABLE "installment_plans" ADD COLUMN     "resultadoVehiculo" TEXT;
ALTER TABLE "installment_plans" ADD COLUMN     "resolucionDetalle" JSONB;

-- Renombrar categorías existentes a las keys del flujo de resolución
UPDATE "cash_movement_categories" SET "name" = 'GASTO_RETIRO_COBRADO' WHERE "name" = 'GASTO_RETIRO';
UPDATE "cash_movement_categories" SET "name" = 'DEVOLUCION'           WHERE "name" = 'DEVOLUCIONES';

-- Nuevas categorías automáticas de resolución
INSERT INTO "cash_movement_categories" ("name", "type", "system", "isManual", "requiresClient") VALUES
  ('COMISION_NEGOCIACION', 'EGRESO', true, false, false),
  ('GASTO_RETIRO_REAL',    'EGRESO', true, false, false)
ON CONFLICT ("name") DO NOTHING;

-- Marcar como AUTOMÁTICAS (no manuales) las generadas por el sistema
UPDATE "cash_movement_categories" SET "isManual" = false
  WHERE "name" IN ('COBRO_CUOTA','ENTREGA_CAPITAL','GASTO_RETIRO_COBRADO','SELLADO',
                   'COMISION_CUOTA','COMISION_NEGOCIACION','GASTO_RETIRO_REAL','DEVOLUCION');

-- Marcar las manuales que requieren cliente
UPDATE "cash_movement_categories" SET "requiresClient" = true
  WHERE "name" IN ('GASTOS_ADMINISTRATIVOS','GARANTIAS');
