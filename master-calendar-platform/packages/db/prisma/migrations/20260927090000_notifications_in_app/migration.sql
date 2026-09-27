-- AlterEnum
ALTER TYPE "NotificationChannel" ADD VALUE 'in_app';

-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'general',
ADD COLUMN     "readAt" TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "emailNotifications" BOOLEAN NOT NULL DEFAULT false;
