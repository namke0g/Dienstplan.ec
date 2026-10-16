-- AlterTable
ALTER TABLE "Plan" ADD COLUMN     "publishedSnapshot" JSONB,
ADD COLUMN     "publishedVersion" INTEGER;
