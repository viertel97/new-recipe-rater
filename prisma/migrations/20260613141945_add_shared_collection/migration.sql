-- CreateTable
CREATE TABLE "SharedCollection" (
    "id" TEXT NOT NULL,
    "linkIds" TEXT[],
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SharedCollection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SharedCollection_expiresAt_idx" ON "SharedCollection"("expiresAt");

-- AddForeignKey
ALTER TABLE "SharedCollection" ADD CONSTRAINT "SharedCollection_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
