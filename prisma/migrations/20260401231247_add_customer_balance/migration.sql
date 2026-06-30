-- CreateTable
CREATE TABLE "customer_balances" (
    "id" SERIAL NOT NULL,
    "clientId" INTEGER NOT NULL,
    "saldo" DOUBLE PRECISION NOT NULL DEFAULT 0,

    CONSTRAINT "customer_balances_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "customer_balances_clientId_key" ON "customer_balances"("clientId");

-- AddForeignKey
ALTER TABLE "customer_balances" ADD CONSTRAINT "customer_balances_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
