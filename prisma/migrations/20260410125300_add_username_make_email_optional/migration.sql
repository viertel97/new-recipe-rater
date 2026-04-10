-- AlterTable
ALTER TABLE "User" ADD COLUMN "username" TEXT;

-- Backfill existing rows (use email as username fallback)
UPDATE "User" SET "username" = "email" WHERE "username" IS NULL;

-- Make username required
ALTER TABLE "User" ALTER COLUMN "username" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- AlterTable: make email optional
ALTER TABLE "User" ALTER COLUMN "email" DROP NOT NULL;
