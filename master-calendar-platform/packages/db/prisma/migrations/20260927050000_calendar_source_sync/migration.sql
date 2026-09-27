-- AlterTable
ALTER TABLE "CalendarSource" ADD COLUMN     "defaultEventTagId" UUID,
ADD COLUMN     "httpEtag" TEXT,
ADD COLUMN     "httpLastModified" TEXT,
ADD COLUMN     "lastSyncError" TEXT,
ADD COLUMN     "lastSyncStats" JSONB,
ADD COLUMN     "nextSyncAt" TIMESTAMPTZ(3);

-- CreateIndex
CREATE INDEX "CalendarSource_type_nextSyncAt_idx" ON "CalendarSource"("type", "nextSyncAt");

-- AddForeignKey
ALTER TABLE "CalendarSource" ADD CONSTRAINT "CalendarSource_defaultEventTagId_fkey" FOREIGN KEY ("defaultEventTagId") REFERENCES "EventTagDefinition"("id") ON DELETE SET NULL ON UPDATE CASCADE;
