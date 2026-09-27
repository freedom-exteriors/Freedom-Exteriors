-- CreateEnum
CREATE TYPE "WorkspaceKind" AS ENUM ('home', 'circle');

-- CreateEnum
CREATE TYPE "TaskPriority" AS ENUM ('low', 'normal', 'high');

-- CreateEnum
CREATE TYPE "Retailer" AS ENUM ('amazon', 'target', 'walmart', 'kroger', 'instacart');

-- CreateEnum
CREATE TYPE "GoalHorizon" AS ENUM ('short_term', 'long_term');

-- CreateEnum
CREATE TYPE "GoalStatus" AS ENUM ('active', 'achieved', 'dropped');

-- AlterTable
ALTER TABLE "Participant" ADD COLUMN     "linkedWorkspaceId" UUID;

-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "completedByUserId" UUID,
ADD COLUMN     "createdByUserId" UUID,
ADD COLUMN     "goalId" UUID,
ADD COLUMN     "notes" TEXT,
ADD COLUMN     "occurrenceDate" DATE,
ADD COLUMN     "position" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "priority" "TaskPriority" NOT NULL DEFAULT 'normal',
ADD COLUMN     "recurringReminderId" UUID,
ADD COLUMN     "taskListId" UUID;

-- AlterTable
ALTER TABLE "Workspace" ADD COLUMN     "kind" "WorkspaceKind" NOT NULL DEFAULT 'home';

-- CreateTable
CREATE TABLE "WorkspaceInvite" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "email" TEXT,
    "role" "MembershipRole" NOT NULL,
    "invitedByUserId" UUID NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "acceptedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkspaceInvite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskList" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "key" TEXT,
    "name" TEXT NOT NULL,
    "viewerCanAdd" BOOLEAN NOT NULL DEFAULT false,
    "position" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "archivedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskList_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShoppingList" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "key" TEXT,
    "name" TEXT NOT NULL,
    "preferredRetailer" "Retailer",
    "viewerCanAdd" BOOLEAN NOT NULL DEFAULT true,
    "position" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "archivedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShoppingList_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShoppingItem" (
    "id" UUID NOT NULL,
    "shoppingListId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "quantity" TEXT,
    "category" TEXT,
    "notes" TEXT,
    "isStaple" BOOLEAN NOT NULL DEFAULT false,
    "retailerRefs" JSONB,
    "position" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "checkedAt" TIMESTAMPTZ(3),
    "addedByUserId" UUID,
    "checkedByUserId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShoppingItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Goal" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "participantId" UUID,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "horizon" "GoalHorizon" NOT NULL,
    "status" "GoalStatus" NOT NULL DEFAULT 'active',
    "targetDate" DATE,
    "position" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "achievedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Goal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecurringReminder" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "notes" TEXT,
    "category" TEXT,
    "rrule" TEXT NOT NULL,
    "leadDays" INTEGER NOT NULL DEFAULT 7,
    "taskListId" UUID,
    "assignedParticipantId" UUID,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RecurringReminder_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WorkspaceInvite_tokenHash_key" ON "WorkspaceInvite"("tokenHash");

-- CreateIndex
CREATE INDEX "WorkspaceInvite_workspaceId_idx" ON "WorkspaceInvite"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "TaskList_workspaceId_key_key" ON "TaskList"("workspaceId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "ShoppingList_workspaceId_key_key" ON "ShoppingList"("workspaceId", "key");

-- CreateIndex
CREATE INDEX "ShoppingItem_shoppingListId_checkedAt_idx" ON "ShoppingItem"("shoppingListId", "checkedAt");

-- CreateIndex
CREATE INDEX "Goal_workspaceId_status_idx" ON "Goal"("workspaceId", "status");

-- CreateIndex
CREATE INDEX "RecurringReminder_workspaceId_enabled_idx" ON "RecurringReminder"("workspaceId", "enabled");

-- CreateIndex
CREATE UNIQUE INDEX "Participant_workspaceId_linkedWorkspaceId_key" ON "Participant"("workspaceId", "linkedWorkspaceId");

-- CreateIndex
CREATE INDEX "Task_taskListId_position_idx" ON "Task"("taskListId", "position");

-- CreateIndex
CREATE INDEX "Task_goalId_idx" ON "Task"("goalId");

-- CreateIndex
CREATE UNIQUE INDEX "Task_recurringReminderId_occurrenceDate_key" ON "Task"("recurringReminderId", "occurrenceDate");

-- AddForeignKey
ALTER TABLE "WorkspaceInvite" ADD CONSTRAINT "WorkspaceInvite_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceInvite" ADD CONSTRAINT "WorkspaceInvite_invitedByUserId_fkey" FOREIGN KEY ("invitedByUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Participant" ADD CONSTRAINT "Participant_linkedWorkspaceId_fkey" FOREIGN KEY ("linkedWorkspaceId") REFERENCES "Workspace"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_taskListId_fkey" FOREIGN KEY ("taskListId") REFERENCES "TaskList"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "Goal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_recurringReminderId_fkey" FOREIGN KEY ("recurringReminderId") REFERENCES "RecurringReminder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_completedByUserId_fkey" FOREIGN KEY ("completedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskList" ADD CONSTRAINT "TaskList_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShoppingList" ADD CONSTRAINT "ShoppingList_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShoppingItem" ADD CONSTRAINT "ShoppingItem_shoppingListId_fkey" FOREIGN KEY ("shoppingListId") REFERENCES "ShoppingList"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShoppingItem" ADD CONSTRAINT "ShoppingItem_addedByUserId_fkey" FOREIGN KEY ("addedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShoppingItem" ADD CONSTRAINT "ShoppingItem_checkedByUserId_fkey" FOREIGN KEY ("checkedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Goal" ADD CONSTRAINT "Goal_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Goal" ADD CONSTRAINT "Goal_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "Participant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringReminder" ADD CONSTRAINT "RecurringReminder_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringReminder" ADD CONSTRAINT "RecurringReminder_taskListId_fkey" FOREIGN KEY ("taskListId") REFERENCES "TaskList"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringReminder" ADD CONSTRAINT "RecurringReminder_assignedParticipantId_fkey" FOREIGN KEY ("assignedParticipantId") REFERENCES "Participant"("id") ON DELETE SET NULL ON UPDATE CASCADE;
