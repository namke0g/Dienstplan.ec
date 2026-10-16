-- CreateEnum
CREATE TYPE "ShiftKind" AS ENUM ('WORK', 'VACATION', 'SPECIAL_LEAVE', 'SICK');

-- AlterTable
ALTER TABLE "ShiftType" ADD COLUMN     "kind" "ShiftKind" NOT NULL DEFAULT 'WORK',
ADD COLUMN     "paid" BOOLEAN NOT NULL DEFAULT true;
