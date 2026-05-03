-- CreateEnum
CREATE TYPE "Category" AS ENUM ('DINNER', 'SNACK', 'CAKE', 'BREAKFAST');

-- CreateEnum
CREATE TYPE "CategoryStatus" AS ENUM ('PENDING', 'DONE', 'FAILED');

-- AlterTable
ALTER TABLE "Link"
  ADD COLUMN "category" "Category",
  ADD COLUMN "categoryStatus" "CategoryStatus" NOT NULL DEFAULT 'PENDING',
  ADD COLUMN "categoryError" TEXT,
  ADD COLUMN "categoryAttempts" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "Link_categoryStatus_idx" ON "Link"("categoryStatus");
