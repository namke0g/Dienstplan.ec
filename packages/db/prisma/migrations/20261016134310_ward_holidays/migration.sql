-- AlterTable
ALTER TABLE "Ward" ADD COLUMN     "state" TEXT;

-- CreateTable
CREATE TABLE "WardHoliday" (
    "id" TEXT NOT NULL,
    "wardId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "WardHoliday_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WardHoliday_wardId_date_key" ON "WardHoliday"("wardId", "date");

-- AddForeignKey
ALTER TABLE "WardHoliday" ADD CONSTRAINT "WardHoliday_wardId_fkey" FOREIGN KEY ("wardId") REFERENCES "Ward"("id") ON DELETE CASCADE ON UPDATE CASCADE;
