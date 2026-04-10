/*
  Warnings:

  - You are about to drop the column `role` on the `User` table. All the data in the column will be lost.

*/
-- CreateEnum
CREATE TYPE "Urgency" AS ENUM ('TOMORROW', 'NEXT_WEEK', 'NEXT_MONTH', 'ARCHIVE');

-- AlterTable
ALTER TABLE "Link" ADD COLUMN     "reviewNote" TEXT,
ADD COLUMN     "urgency" "Urgency";

-- AlterTable
ALTER TABLE "User" DROP COLUMN "role";

-- DropEnum
DROP TYPE "Role";
