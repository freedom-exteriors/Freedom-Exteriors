// Automation rules: "for every <tag> event, <offset> minutes before, do <action>".
//  - create_reminder: a task, due at start − offset ("Pack uniform for {{title}}").
//  - flag_unassigned_task: a task only while the event needs a person — nobody's claimed
//    it, or it has somewhere to be and nobody's driving. It completes itself once the gap
//    is filled, so stale nags don't pile up.
// Tasks are created up to CREATE_AHEAD_DAYS before they're due, and (rule, event) is
// unique, so reruns never duplicate. Moved events move their open tasks' due dates.
import type { PrismaClient } from "@mcp/db";
import { formatClock } from "@mcp/planner";

export const CREATE_AHEAD_DAYS = 7;

type EventLike = { title: string; startTime: Date; location: string | null; participant: { name: string } | null };

export function renderTemplate(tpl: string, e: EventLike, timeZone: string): string {
  const date = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short", month: "short", day: "numeric" }).format(e.startTime);
  const values: Record<string, string> = {
    title: e.title,
    date,
    time: formatClock(e.startTime, timeZone),
    person: e.participant?.name ?? "someone",
    location: e.location ?? "",
  };
  return tpl.replace(/\{\{\s*(\w+)\s*\}\}/g, (m, k: string) => values[k] ?? m).slice(0, 300);
}

function needsPerson(e: { participantId: string | null; driverParticipantId: string | null; placeId: string | null; location: string | null; allDay: boolean }) {
  const needsDriver = (e.placeId !== null || e.location !== null) && e.driverParticipantId === null && !e.allDay;
  return e.participantId === null || needsDriver;
}

export async function runAutomation(prisma: PrismaClient, opts: { now?: Date; workspaceId?: string } = {}) {
  const now = opts.now ?? new Date();
  const stats = { created: 0, rescheduled: 0, resolved: 0 };
  const rules = await prisma.automationRule.findMany({ where: { enabled: true, ...(opts.workspaceId ? { workspaceId: opts.workspaceId } : {}) }, include: { workspace: { select: { timeZone: true } } } });

  for (const rule of rules) {
    const offsetMs = rule.timingOffsetMinutes * 60_000;
    const events = await prisma.event.findMany({
      where: {
        eventTagId: rule.eventTagId,
        calendarSource: { workspaceId: rule.workspaceId },
        startTime: { gt: now, lte: new Date(now.getTime() + CREATE_AHEAD_DAYS * 86_400_000 + Math.max(0, offsetMs)) },
      },
      include: { participant: { select: { name: true } }, tasks: { where: { automationRuleId: rule.id } } },
    });
    const payload = (rule.actionPayload ?? {}) as { titleTemplate?: string };
    const tpl = payload.titleTemplate ?? (rule.actionType === "flag_unassigned_task" ? "Needs someone: {{title}}" : "Get ready: {{title}}");

    for (const e of events) {
      const dueAt = new Date(e.startTime.getTime() - offsetMs);
      const existing = e.tasks[0];
      const wanted = rule.actionType === "create_reminder" || needsPerson(e);

      if (existing) {
        if (!existing.completedAt && existing.dueAt?.getTime() !== dueAt.getTime()) {
          await prisma.task.update({ where: { id: existing.id }, data: { dueAt } });
          stats.rescheduled++;
        }
        if (rule.actionType === "flag_unassigned_task" && !wanted && !existing.completedAt) {
          await prisma.task.update({ where: { id: existing.id }, data: { completedAt: now, notes: "Resolved automatically — someone's on it." } });
          stats.resolved++;
        }
        continue;
      }
      if (!wanted || dueAt.getTime() - now.getTime() > CREATE_AHEAD_DAYS * 86_400_000) continue;
      const { count } = await prisma.task.createMany({
        data: [{
          workspaceId: rule.workspaceId,
          eventId: e.id,
          automationRuleId: rule.id,
          title: renderTemplate(tpl, e, rule.workspace.timeZone),
          dueAt,
          priority: rule.actionType === "flag_unassigned_task" ? "high" : "normal",
          // Reminders go to whoever's driving if we know; flags are for anyone to pick up.
          assignedParticipantId: rule.actionType === "create_reminder" ? e.driverParticipantId : null,
        }],
        skipDuplicates: true, // another worker got there first
      });
      stats.created += count;
    }
  }
  return stats;
}
