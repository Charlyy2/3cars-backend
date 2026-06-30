-- CreateTable
CREATE TABLE "financing" (
    "id" SERIAL NOT NULL,
    "clientId" INTEGER NOT NULL,
    "saldo" DOUBLE PRECISION NOT NULL,
    "tasaAnual" DOUBLE PRECISION NOT NULL,
    "fechaInicio" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "financing_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "financing" ADD CONSTRAINT "financing_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
