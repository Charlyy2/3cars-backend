-- Separar la mora diaria en dos tasas: planes vs negociación (saldo).
ALTER TABLE "config" ADD COLUMN "moraDiariaPlan" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "config" ADD COLUMN "moraDiariaNegociacion" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- Backfill: partir de la mora única anterior para no cambiar el comportamiento vigente.
UPDATE "config"
SET "moraDiariaPlan" = "moraDiariaDefault",
    "moraDiariaNegociacion" = "moraDiariaDefault";
