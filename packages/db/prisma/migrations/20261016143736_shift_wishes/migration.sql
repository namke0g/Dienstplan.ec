-- CreateEnum
CREATE TYPE "WishKind" AS ENUM ('FREE', 'SHIFT');

-- AlterTable
ALTER TABLE "Ward" ADD COLUMN     "freeWishesPerMonth" INTEGER NOT NULL DEFAULT 4;

-- CreateTable
CREATE TABLE "ShiftWish" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "wardId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "kind" "WishKind" NOT NULL,
    "shiftTypeId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShiftWish_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShiftPreference" (
    "userId" TEXT NOT NULL,
    "prefer" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "avoid" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "note" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShiftPreference_pkey" PRIMARY KEY ("userId")
);

-- CreateIndex
CREATE INDEX "ShiftWish_wardId_date_idx" ON "ShiftWish"("wardId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "ShiftWish_userId_date_key" ON "ShiftWish"("userId", "date");

-- AddForeignKey
ALTER TABLE "ShiftWish" ADD CONSTRAINT "ShiftWish_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftWish" ADD CONSTRAINT "ShiftWish_shiftTypeId_fkey" FOREIGN KEY ("shiftTypeId") REFERENCES "ShiftType"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftPreference" ADD CONSTRAINT "ShiftPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
