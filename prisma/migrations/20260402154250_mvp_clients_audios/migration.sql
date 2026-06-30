-- AlterTable
ALTER TABLE "clients" ADD COLUMN     "fechaSuscripcion" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "tipoContrato" TEXT NOT NULL DEFAULT 'PLAN';

-- CreateTable
CREATE TABLE "audios" (
    "id" SERIAL NOT NULL,
    "clientId" INTEGER NOT NULL,
    "url" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audios_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "audios" ADD CONSTRAINT "audios_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
