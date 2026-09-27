import type { WorkspaceVertical } from "@mcp/shared-types";
import { getVerticalTemplate } from "../seed-templates/index.js";
import type { Prisma, PrismaClient } from "./generated/prisma/client.js";

export interface CreateWorkspaceInput {
  name: string;
  vertical: WorkspaceVertical;
  /** If given, this user becomes the workspace owner. */
  ownerUserId?: string;
}

/**
 * Creates a workspace and seeds its tag definitions + default automation rules from the
 * vertical's static template. Used by the dev seed script now and by signup (step 2).
 */
export async function createWorkspaceFromTemplate(prisma: PrismaClient, input: CreateWorkspaceInput) {
  const template = getVerticalTemplate(input.vertical);

  return prisma.$transaction(async (tx) => {
    const workspace = await tx.workspace.create({
      data: { name: input.name, vertical: input.vertical },
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
          throw new Error(`Template "${template.vertical}" rule references unknown tag "${r.tagKey}"`);
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

    if (input.ownerUserId) {
      await tx.workspaceMembership.create({
        data: { userId: input.ownerUserId, workspaceId: workspace.id, role: "owner" },
      });
    }

    return workspace;
  });
}
