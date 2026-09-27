import type { WorkspaceKind, WorkspaceVertical } from "@mcp/shared-types";
import { getWorkspaceTemplate } from "../seed-templates/index.js";
import type { Prisma, PrismaClient } from "./generated/prisma/client.js";

export interface CreateWorkspaceInput {
  name: string;
  vertical: WorkspaceVertical;
  kind?: WorkspaceKind; // default "home"
  /** If given, this user becomes the workspace owner. */
  ownerUserId?: string;
}

/**
 * Creates a workspace and seeds its tag definitions, default automation rules, default
 * task/shopping lists, and seasonal reminders from its static template (the vertical's for
 * a home, the shared circle template for a circle). Used by the dev seed script now and
 * by signup (step 2).
 */
export async function createWorkspaceFromTemplate(prisma: PrismaClient, input: CreateWorkspaceInput) {
  const kind = input.kind ?? "home";
  const template = getWorkspaceTemplate(kind, input.vertical);

  return prisma.$transaction(async (tx) => {
    const workspace = await tx.workspace.create({
      data: { name: input.name, vertical: input.vertical, kind },
    });

    await tx.eventTagDefinition.createMany({
      data: template.eventTags.map((t) => ({ workspaceId: workspace.id, ...t })),
    });
    const tags = await tx.eventTagDefinition.findMany({ where: { workspaceId: workspace.id } });
    const tagIdByKey = new Map(tags.map((t) => [t.key, t.id]));

    await tx.automationRule.createMany({
      data: template.automationRules.map((r) => {
        const eventTagId = tagIdByKey.get(r.tagKey);
        if (!eventTagId) {
          throw new Error(`Template "${template.id}" rule references unknown tag "${r.tagKey}"`);
        }
        return {
          workspaceId: workspace.id,
          eventTagId,
          timingOffsetMinutes: r.timingOffsetMinutes,
          actionType: r.actionType,
          actionPayload: r.actionPayload as Prisma.InputJsonValue,
        };
      }),
    });

    await tx.taskList.createMany({
      data: template.taskLists.map((l, i) => ({ workspaceId: workspace.id, position: i, ...l })),
    });
    await tx.shoppingList.createMany({
      data: template.shoppingLists.map((l, i) => ({ workspaceId: workspace.id, position: i, ...l })),
    });
    const taskLists = await tx.taskList.findMany({ where: { workspaceId: workspace.id } });
    const taskListIdByKey = new Map(taskLists.map((l) => [l.key, l.id]));

    await tx.recurringReminder.createMany({
      data: template.recurringReminders.map(({ taskListKey, ...r }) => {
        const taskListId = taskListKey ? taskListIdByKey.get(taskListKey) : null;
        if (taskListId === undefined) {
          throw new Error(`Template "${template.id}" reminder references unknown list "${taskListKey}"`);
        }
        return { workspaceId: workspace.id, taskListId, ...r };
      }),
    });

    if (input.ownerUserId) {
      await tx.workspaceMembership.create({
        data: { userId: input.ownerUserId, workspaceId: workspace.id, role: "owner" },
      });
    }

    return workspace;
  });
}

/**
 * Adds a home to a circle as a Participant that stands for that home (colored per
 * household), so circle events/tasks can be assigned to "the Chen family". Membership
 * of the home's users in the circle is granted separately (via WorkspaceInvite).
 */
export async function addHomeToCircle(
  prisma: PrismaClient,
  input: { circleId: string; homeWorkspaceId: string; color: string; name?: string },
) {
  const [circle, home] = await Promise.all([
    prisma.workspace.findUniqueOrThrow({ where: { id: input.circleId } }),
    prisma.workspace.findUniqueOrThrow({ where: { id: input.homeWorkspaceId } }),
  ]);
  if (circle.kind !== "circle") throw new Error("addHomeToCircle: target is not a circle");
  if (home.kind !== "home") throw new Error("addHomeToCircle: only homes can join a circle");
  return prisma.participant.create({
    data: { workspaceId: circle.id, linkedWorkspaceId: home.id, name: input.name ?? home.name, color: input.color },
  });
}
