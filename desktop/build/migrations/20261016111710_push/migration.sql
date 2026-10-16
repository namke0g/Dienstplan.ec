-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "pushAttemptedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "pushEnabled" BOOLEAN NOT NULL DEFAULT true;
