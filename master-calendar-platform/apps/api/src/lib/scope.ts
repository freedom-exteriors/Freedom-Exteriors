// The DB can't stop an event in workspace A from pointing at a participant or tag in
// workspace B (Event reaches its workspace through CalendarSource). Every write that
// accepts such an id from a client must check it here.
import type { PrismaClient } from "@mcp/db";
import { badRequest } from "./errors.js";

export async function assertParticipantIn(prisma: PrismaClient, workspaceId: string, participantId: string | null | undefined) {
  if (!participantId) return;
  const ok = await prisma.participant.count({ where: { id: participantId, workspaceId } });
  if (!ok) throw badRequest("invalid_participant", "That person isn't in this workspace");
}

export async function assertTagIn(prisma: PrismaClient, workspaceId: string, tagId: string | null | undefined) {
  if (!tagId) return;
  const ok = await prisma.eventTagDefinition.count({ where: { id: tagId, workspaceId } });
  if (!ok) throw badRequest("invalid_tag", "That tag isn't in this workspace");
}
