-- CreateEnum
CREATE TYPE "TaskLocationKind" AS ENUM ('home', 'errand', 'anywhere');

-- CreateEnum
CREATE TYPE "TaskScheduleStatus" AS ENUM ('suggested', 'accepted');

-- CreateEnum
CREATE TYPE "PlaceKind" AS ENUM ('home', 'work', 'school', 'activity', 'store', 'other');

-- CreateEnum
CREATE TYPE "DepartureAlertStatus" AS ENUM ('scheduled', 'notified', 'skipped');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('web_push', 'sms', 'email');

-- AlterTable
ALTER TABLE "Event" ADD COLUMN     "driverParticipantId" UUID,
ADD COLUMN     "placeId" UUID;

-- AlterTable
ALTER TABLE "Participant" ADD COLUMN     "canDrive" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "homePlaceId" UUID,
ADD COLUMN     "maxPlannedTaskMinutesPerDay" INTEGER NOT NULL DEFAULT 90;

-- AlterTable
ALTER TABLE "ShoppingList" ADD COLUMN     "placeId" UUID;

-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "estimatedMinutes" INTEGER,
ADD COLUMN     "locationKind" "TaskLocationKind" NOT NULL DEFAULT 'home',
ADD COLUMN     "placeId" UUID,
ADD COLUMN     "scheduleReason" TEXT,
ADD COLUMN     "scheduleStatus" "TaskScheduleStatus",
ADD COLUMN     "scheduledEnd" TIMESTAMPTZ(3),
ADD COLUMN     "scheduledStart" TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "Workspace" ADD COLUMN     "timeZone" TEXT NOT NULL DEFAULT 'America/Chicago';

-- CreateTable
CREATE TABLE "Place" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "PlaceKind" NOT NULL DEFAULT 'other',
    "address" TEXT,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "googlePlaceId" TEXT,
    "arrivalBufferMinutes" INTEGER NOT NULL DEFAULT 5,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Place_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AvailabilityWindow" (
    "id" UUID NOT NULL,
    "participantId" UUID NOT NULL,
    "dayOfWeek" INTEGER NOT NULL,
    "startMinute" INTEGER NOT NULL,
    "endMinute" INTEGER NOT NULL,

    CONSTRAINT "AvailabilityWindow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DepartureAlert" (
    "id" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "participantId" UUID NOT NULL,
    "originLabel" TEXT NOT NULL,
    "originLatitude" DOUBLE PRECISION NOT NULL,
    "originLongitude" DOUBLE PRECISION NOT NULL,
    "leaveBy" TIMESTAMPTZ(3) NOT NULL,
    "trafficMinutes" INTEGER NOT NULL,
    "typicalMinutes" INTEGER NOT NULL,
    "nextCheckAt" TIMESTAMPTZ(3),
    "lastCheckedAt" TIMESTAMPTZ(3) NOT NULL,
    "notifiedAt" TIMESTAMPTZ(3),
    "status" "DepartureAlertStatus" NOT NULL DEFAULT 'scheduled',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DepartureAlert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "url" TEXT,
    "sendAt" TIMESTAMPTZ(3) NOT NULL,
    "sentAt" TIMESTAMPTZ(3),
    "error" TEXT,
    "dedupeKey" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Place_workspaceId_idx" ON "Place"("workspaceId");

-- CreateIndex
CREATE INDEX "AvailabilityWindow_participantId_idx" ON "AvailabilityWindow"("participantId");

-- CreateIndex
CREATE INDEX "DepartureAlert_status_nextCheckAt_idx" ON "DepartureAlert"("status", "nextCheckAt");

-- CreateIndex
CREATE UNIQUE INDEX "DepartureAlert_eventId_participantId_key" ON "DepartureAlert"("eventId", "participantId");

-- CreateIndex
CREATE INDEX "Notification_sentAt_sendAt_idx" ON "Notification"("sentAt", "sendAt");

-- CreateIndex
CREATE UNIQUE INDEX "Notification_userId_dedupeKey_channel_key" ON "Notification"("userId", "dedupeKey", "channel");

-- AddForeignKey
ALTER TABLE "Participant" ADD CONSTRAINT "Participant_homePlaceId_fkey" FOREIGN KEY ("homePlaceId") REFERENCES "Place"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_placeId_fkey" FOREIGN KEY ("placeId") REFERENCES "Place"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_driverParticipantId_fkey" FOREIGN KEY ("driverParticipantId") REFERENCES "Participant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_placeId_fkey" FOREIGN KEY ("placeId") REFERENCES "Place"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShoppingList" ADD CONSTRAINT "ShoppingList_placeId_fkey" FOREIGN KEY ("placeId") REFERENCES "Place"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Place" ADD CONSTRAINT "Place_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AvailabilityWindow" ADD CONSTRAINT "AvailabilityWindow_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "Participant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DepartureAlert" ADD CONSTRAINT "DepartureAlert_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DepartureAlert" ADD CONSTRAINT "DepartureAlert_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "Participant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
