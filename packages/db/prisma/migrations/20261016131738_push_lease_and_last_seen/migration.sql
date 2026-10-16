-- AlterTable
ALTER TABLE "DeviceToken" ADD COLUMN     "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "pushClaimedUntil" TIMESTAMP(3);
