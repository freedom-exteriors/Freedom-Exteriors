// Seasonal / recurring reminders → tasks. For each enabled reminder, the next occurrence
// becomes a task `leadDays` ahead of it (on the reminder's list, for its person).
// (reminder, occurrenceDate) is unique, so reruns never duplicate; and if last time's
// task is still open, we don't stack a second one on top of it.
import type { PrismaClient } from "@mcp/db";
import { zonedToUtc } from "@mcp/planner";
import { isoDate, nextDates, todayIn } from "../lib/recurrence.js";

export async function runReminders(prisma: PrismaClient, opts: { now?: Date; workspaceId?: string } = {}) {
  const now = opts.now ?? new Date();
  const stats = { created: 0, skippedOpen: 0, invalid: 0 };
  const reminders = await prisma.recurringReminder.findMany({ where: { enabled: true, ...(opts.workspaceId ? { workspaceId: opts.workspaceId } : {}) }, include: { workspace: { select: { timeZone: true } } } });

  for (const r of reminders) {
    const tz = r.workspace.timeZone;
    const today = todayIn(tz, now);
    let next;
    try {
      [next] = nextDates(r.rrule, today);
    } catch {
      stats.invalid++;
      continue;
    }
    if (!next) continue;
    const showFrom = new Date(Date.UTC(next.year, next.month - 1, next.day - r.leadDays));
    if (showFrom > new Date(Date.UTC(today.year, today.month - 1, today.day))) continue; // not yet

    const open = await prisma.task.count({ where: { recurringReminderId: r.id, completedAt: null } });
    if (open > 0) {
      stats.skippedOpen++;
      continue;
    }
    const { count } = await prisma.task.createMany({
      data: [{
        workspaceId: r.workspaceId,
        recurringReminderId: r.id,
        occurrenceDate: new Date(`${isoDate(next)}T00:00:00Z`),
        taskListId: r.taskListId,
        assignedParticipantId: r.assignedParticipantId,
        title: r.title,
        notes: r.notes,
        dueAt: zonedToUtc(next.year, next.month, next.day, 12 * 60, tz), // midday on the day
      }],
      skipDuplicates: true,
    });
    stats.created += count;
  }
  return stats;
}
