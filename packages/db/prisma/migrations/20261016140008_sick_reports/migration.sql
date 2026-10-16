-- CreateTable
CREATE TABLE "SickReport" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "wardId" TEXT NOT NULL,
    "start" DATE NOT NULL,
    "end" DATE NOT NULL,
    "note" TEXT,
    "reportedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "replaced" JSONB NOT NULL DEFAULT '[]',

    CONSTRAINT "SickReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SickReport_wardId_end_idx" ON "SickReport"("wardId", "end");

-- CreateIndex
CREATE INDEX "SickReport_userId_start_idx" ON "SickReport"("userId", "start");

-- AddForeignKey
ALTER TABLE "SickReport" ADD CONSTRAINT "SickReport_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SickReport" ADD CONSTRAINT "SickReport_reportedById_fkey" FOREIGN KEY ("reportedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
