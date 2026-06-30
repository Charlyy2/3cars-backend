/*
  Warnings:

  - You are about to drop the column `url` on the `audios` table. All the data in the column will be lost.
  - Added the required column `filename` to the `audios` table without a default value. This is not possible if the table is not empty.
  - Added the required column `mimeType` to the `audios` table without a default value. This is not possible if the table is not empty.
  - Added the required column `originalName` to the `audios` table without a default value. This is not possible if the table is not empty.
  - Added the required column `size` to the `audios` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "audios" DROP COLUMN "url",
ADD COLUMN     "filename" TEXT NOT NULL,
ADD COLUMN     "mimeType" TEXT NOT NULL,
ADD COLUMN     "originalName" TEXT NOT NULL,
ADD COLUMN     "size" INTEGER NOT NULL,
ADD COLUMN     "uploadedBy" TEXT;

-- CreateTable
CREATE TABLE "payment_attachments" (
    "id" SERIAL NOT NULL,
    "paymentId" INTEGER NOT NULL,
    "filename" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "uploadedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_attachments_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "payment_attachments" ADD CONSTRAINT "payment_attachments_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
