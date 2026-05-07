-- Rename localPath → blobUrl, thumbnailPath → thumbnailUrl
ALTER TABLE "MediaAsset" RENAME COLUMN "localPath" TO "blobUrl";
ALTER TABLE "MediaAsset" RENAME COLUMN "thumbnailPath" TO "thumbnailUrl";
