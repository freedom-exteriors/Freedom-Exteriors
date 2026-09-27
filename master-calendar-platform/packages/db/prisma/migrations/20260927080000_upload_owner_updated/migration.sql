-- AlterTable
ALTER TABLE "UploadedScheduleImage" ADD COLUMN     "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "uploadedByUserId" UUID;

-- CreateIndex
CREATE INDEX "UploadedScheduleImage_status_updatedAt_idx" ON "UploadedScheduleImage"("status", "updatedAt");

-- AddForeignKey
ALTER TABLE "UploadedScheduleImage" ADD CONSTRAINT "UploadedScheduleImage_uploadedByUserId_fkey" FOREIGN KEY ("uploadedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
