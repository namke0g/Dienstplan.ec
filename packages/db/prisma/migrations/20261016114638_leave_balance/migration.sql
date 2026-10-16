-- CreateEnum
CREATE TYPE "LeaveCountMode" AS ENUM ('WEEKDAYS', 'ALL_DAYS');

-- AlterTable
ALTER TABLE "ShiftType" ADD COLUMN     "consumesLeave" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Ward" ADD COLUMN     "leaveCountMode" "LeaveCountMode" NOT NULL DEFAULT 'WEEKDAYS';

-- CreateTable
CREATE TABLE "LeaveEntitlement" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "entitlement" DOUBLE PRECISION NOT NULL,
    "carryOver" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "carryOverExpires" DATE,
    "adjustment" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "note" TEXT,

    CONSTRAINT "LeaveEntitlement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LeaveEntitlement_userId_year_key" ON "LeaveEntitlement"("userId", "year");

-- AddForeignKey
ALTER TABLE "LeaveEntitlement" ADD CONSTRAINT "LeaveEntitlement_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- existing paid vacation types deduct from the balance
UPDATE "ShiftType" SET "consumesLeave" = true WHERE "kind" = 'VACATION' AND "paid" = true;
