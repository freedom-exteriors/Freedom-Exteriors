-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "scheduledParticipantId" UUID;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_scheduledParticipantId_fkey" FOREIGN KEY ("scheduledParticipantId") REFERENCES "Participant"("id") ON DELETE SET NULL ON UPDATE CASCADE;
