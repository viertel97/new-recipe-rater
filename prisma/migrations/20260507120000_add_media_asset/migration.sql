-- CreateEnum
CREATE TYPE "MediaType" AS ENUM ('VIDEO', 'IMAGE');

-- CreateEnum
CREATE TYPE "MediaStatus" AS ENUM ('PENDING', 'RESOLVED', 'FAILED', 'EVICTED');

-- CreateTable
CREATE TABLE "MediaAsset" (
    "id" TEXT NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "type" "MediaType" NOT NULL,
    "localPath" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "thumbnailPath" TEXT,
    "title" TEXT,
    "description" TEXT,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MediaAsset_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MediaAsset_sourceUrl_key" ON "MediaAsset"("sourceUrl");

-- AlterTable
ALTER TABLE "Link" ADD COLUMN "mediaAssetId" TEXT,
ADD COLUMN "mediaError" TEXT,
ADD COLUMN "mediaStatus" "MediaStatus" NOT NULL DEFAULT 'PENDING';

-- CreateIndex
CREATE UNIQUE INDEX "Link_mediaAssetId_key" ON "Link"("mediaAssetId");

-- CreateIndex
CREATE INDEX "Link_mediaStatus_idx" ON "Link"("mediaStatus");

-- AddForeignKey
ALTER TABLE "Link" ADD CONSTRAINT "Link_mediaAssetId_fkey" FOREIGN KEY ("mediaAssetId") REFERENCES "MediaAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;
