-- AlterTable
ALTER TABLE "clients" ADD COLUMN     "apellido" TEXT,
ADD COLUMN     "codigoPostal" TEXT,
ADD COLUMN     "dni" TEXT,
ADD COLUMN     "domicilio" TEXT,
ADD COLUMN     "email" TEXT,
ADD COLUMN     "fechaNacimiento" TIMESTAMP(3),
ADD COLUMN     "ingresosMensuales" DOUBLE PRECISION,
ADD COLUMN     "localidad" TEXT,
ADD COLUMN     "provincia" TEXT,
ADD COLUMN     "sexo" TEXT,
ADD COLUMN     "telefonoCelular" TEXT,
ADD COLUMN     "telefonoFijo" TEXT;

-- AlterTable
ALTER TABLE "installment_plans" ADD COLUMN     "observaciones" TEXT;
