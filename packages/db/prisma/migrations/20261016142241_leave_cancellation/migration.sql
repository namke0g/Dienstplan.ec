-- AlterTable
ALTER TABLE "LeaveRequest" ADD COLUMN     "cancelReason" TEXT,
ADD COLUMN     "cancelRequestedAt" TIMESTAMP(3),
ADD COLUMN     "cancelledAt" TIMESTAMP(3),
ADD COLUMN     "cancelledById" TEXT;
