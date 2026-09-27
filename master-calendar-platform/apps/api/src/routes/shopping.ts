// Shared shopping lists: everyone (kids included, on open lists) adds; items sort in the
// store's walking order; staples survive being bought and restock in one tap.
import type { FastifyInstance } from "fastify";
import type { Prisma } from "@mcp/db";
import { getWorkspaceTemplate } from "@mcp/db";
import { z } from "zod";
import { HttpError, badRequest, forbidden, notFound } from "../lib/errors.js";
import { parse } from "../lib/validate.js";
import { assertCanContribute, nextPosition } from "../lib/perm.js";
import { requireWorkspace } from "../auth/plugin.js";
import { buildHandoff } from "../lib/retail.js";

const uuid = z.string().uuid();
const retailer = z.enum(["amazon", "target", "walmart", "kroger", "instacart"]);
const retailerRefs = z
  .partialRecord(z.enum(["amazon", "target", "walmart", "kroger", "instacart"]), z.record(z.string(), z.string().max(60)))
  .nullable()
  .optional();
const listBody = z.object({
  name: z.string().trim().min(1).max(120),
  preferredRetailer: retailer.nullable().optional(),
  placeId: uuid.nullable().optional(),
  viewerCanAdd: z.boolean().default(true),
});
const listPatch = listBody.partial().extend({ position: z.number().optional(), archived: z.boolean().optional() });
const itemBody = z.object({
  name: z.string().trim().min(1).max(200),
  quantity: z.string().trim().max(50).nullable().optional(),
  category: z.string().trim().max(60).nullable().optional(),
  notes: z.string().max(1000).nullable().optional(),
  isStaple: z.boolean().optional(),
  retailerRefs,
});
const itemPatch = itemBody.partial().extend({ checked: z.boolean().optional(), position: z.number().optional() });
const listParams = z.object({ workspaceId: uuid, listId: uuid });
const itemParams = listParams.extend({ itemId: uuid });

export async function shoppingRoutes(app: FastifyInstance) {
  const p = app.prisma;

  async function findList(workspaceId: string, listId: string) {
    const list = await p.shoppingList.findFirst({ where: { id: listId, workspaceId } });
    if (!list) throw notFound("List not found");
    return list;
  }
  async function assertPlace(workspaceId: string, placeId: string | null | undefined) {
    if (placeId && !(await p.place.count({ where: { id: placeId, workspaceId } }))) throw badRequest("invalid_place", "That place isn't in this workspace");
  }

  app.get("/workspaces/:workspaceId/shopping-lists", { preHandler: requireWorkspace() }, async (req) => {
    const ws = req.membership!.workspace;
    const lists = await p.shoppingList.findMany({
      where: { workspaceId: ws.id, archivedAt: null },
      include: { place: { select: { id: true, name: true } } },
      orderBy: [{ position: "asc" }, { createdAt: "asc" }],
    });
    const counts = await p.shoppingItem.groupBy({ by: ["shoppingListId"], where: { shoppingListId: { in: lists.map((l) => l.id) }, checkedAt: null }, _count: true });
    const open = new Map(counts.map((c) => [c.shoppingListId, c._count]));
    return {
      categories: getWorkspaceTemplate(ws.kind, ws.vertical).shoppingCategories,
      lists: lists.map((l) => ({ ...l, openCount: open.get(l.id) ?? 0 })),
    };
  });

  app.post("/workspaces/:workspaceId/shopping-lists", { preHandler: requireWorkspace("member") }, async (req, reply) => {
    const body = parse(listBody, req.body);
    const ws = req.membership!.workspaceId;
    await assertPlace(ws, body.placeId);
    const max = await p.shoppingList.aggregate({ where: { workspaceId: ws }, _max: { position: true } });
    return reply.code(201).send(await p.shoppingList.create({ data: { ...body, workspaceId: ws, position: nextPosition(max._max.position) } }));
  });

  app.patch("/workspaces/:workspaceId/shopping-lists/:listId", { preHandler: requireWorkspace("member") }, async (req) => {
    const { listId } = parse(listParams, req.params);
    const { archived, ...body } = parse(listPatch, req.body);
    const ws = req.membership!.workspaceId;
    await findList(ws, listId);
    await assertPlace(ws, body.placeId);
    return p.shoppingList.update({ where: { id: listId }, data: { ...body, ...(archived === undefined ? {} : { archivedAt: archived ? new Date() : null }) } });
  });

  app.get("/workspaces/:workspaceId/shopping-lists/:listId/items", { preHandler: requireWorkspace() }, async (req) => {
    const { listId } = parse(listParams, req.params);
    const ws = req.membership!.workspace;
    const list = await findList(ws.id, listId);
    const items = await p.shoppingItem.findMany({ where: { shoppingListId: list.id } });
    const names = await displayNames(app, ws.id);
    // Walking order: template sections first (Produce, Dairy…), then anything custom, then uncategorized.
    const order = getWorkspaceTemplate(ws.kind, ws.vertical).shoppingCategories.map((c) => c.toLowerCase());
    const rank = (c: string | null) => (c === null ? 1e6 : order.indexOf(c.toLowerCase()) === -1 ? 1e5 : order.indexOf(c.toLowerCase()));
    const sorted = items.sort(
      (a, b) =>
        Number(a.checkedAt !== null) - Number(b.checkedAt !== null) ||
        rank(a.category) - rank(b.category) ||
        (a.category ?? "").localeCompare(b.category ?? "") ||
        a.position - b.position,
    );
    return {
      list,
      items: sorted.map(({ addedByUserId, checkedByUserId, ...i }) => ({
        ...i,
        checked: i.checkedAt !== null,
        addedBy: addedByUserId ? (names.get(addedByUserId) ?? null) : null,
        checkedBy: checkedByUserId ? (names.get(checkedByUserId) ?? null) : null,
      })),
    };
  });

  app.post("/workspaces/:workspaceId/shopping-lists/:listId/items", { preHandler: requireWorkspace() }, async (req, reply) => {
    const { listId } = parse(listParams, req.params);
    const body = parse(itemBody, req.body);
    const m = req.membership!;
    const list = await findList(m.workspaceId, listId);
    assertCanContribute(m.role, list);
    // "Milk" is already on the list? Don't add a second one. A bought staple? Put it back.
    const same = await p.shoppingItem.findFirst({ where: { shoppingListId: list.id, name: { equals: body.name, mode: "insensitive" } }, orderBy: { checkedAt: { sort: "asc", nulls: "first" } } });
    if (same && (same.checkedAt === null || same.isStaple)) {
      const item = same.checkedAt ? await p.shoppingItem.update({ where: { id: same.id }, data: { checkedAt: null, checkedByUserId: null, quantity: body.quantity ?? same.quantity } }) : same;
      return reply.code(200).send({ ...item, checked: false, merged: true });
    }
    const max = await p.shoppingItem.aggregate({ where: { shoppingListId: list.id }, _max: { position: true } });
    const item = await p.shoppingItem.create({
      data: {
        ...body,
        retailerRefs: (body.retailerRefs ?? undefined) as Prisma.InputJsonValue | undefined,
        shoppingListId: list.id,
        position: nextPosition(max._max.position),
        addedByUserId: req.user!.id,
      },
    });
    return reply.code(201).send({ ...item, checked: false, merged: false });
  });

  app.patch("/workspaces/:workspaceId/shopping-lists/:listId/items/:itemId", { preHandler: requireWorkspace() }, async (req) => {
    const { listId, itemId } = parse(itemParams, req.params);
    const { checked, retailerRefs: refs, ...body } = parse(itemPatch, req.body);
    const m = req.membership!;
    const list = await findList(m.workspaceId, listId);
    assertCanContribute(m.role, list);
    const item = await p.shoppingItem.findFirst({ where: { id: itemId, shoppingListId: list.id } });
    if (!item) throw notFound("Item not found");
    const updated = await p.shoppingItem.update({
      where: { id: itemId },
      data: {
        ...body,
        ...(refs !== undefined ? { retailerRefs: (refs ?? undefined) as Prisma.InputJsonValue | undefined } : {}),
        ...(checked === true && !item.checkedAt ? { checkedAt: new Date(), checkedByUserId: req.user!.id } : {}),
        ...(checked === false ? { checkedAt: null, checkedByUserId: null } : {}),
      },
    });
    return { ...updated, checked: updated.checkedAt !== null };
  });

  app.delete("/workspaces/:workspaceId/shopping-lists/:listId/items/:itemId", { preHandler: requireWorkspace() }, async (req, reply) => {
    const { listId, itemId } = parse(itemParams, req.params);
    const m = req.membership!;
    const list = await findList(m.workspaceId, listId);
    const item = await p.shoppingItem.findFirst({ where: { id: itemId, shoppingListId: list.id } });
    if (!item) throw notFound("Item not found");
    if (m.role === "viewer" && item.addedByUserId !== req.user!.id) throw forbidden("You can only remove things you added");
    await p.shoppingItem.delete({ where: { id: itemId } });
    return reply.code(204).send();
  });

  // After the trip: bought one-offs go away; staples stay (checked) for next time.
  app.post("/workspaces/:workspaceId/shopping-lists/:listId/clear-checked", { preHandler: requireWorkspace("member") }, async (req) => {
    const { listId } = parse(listParams, req.params);
    const list = await findList(req.membership!.workspaceId, listId);
    const { count } = await p.shoppingItem.deleteMany({ where: { shoppingListId: list.id, checkedAt: { not: null }, isStaple: false } });
    return { removed: count };
  });

  app.post("/workspaces/:workspaceId/shopping-lists/:listId/restock-staples", { preHandler: requireWorkspace() }, async (req) => {
    const { listId } = parse(listParams, req.params);
    const m = req.membership!;
    const list = await findList(m.workspaceId, listId);
    assertCanContribute(m.role, list);
    const { count } = await p.shoppingItem.updateMany({ where: { shoppingListId: list.id, isStaple: true, checkedAt: { not: null } }, data: { checkedAt: null, checkedByUserId: null } });
    return { restocked: count };
  });

  app.get("/workspaces/:workspaceId/shopping-lists/:listId/handoff", { preHandler: requireWorkspace() }, async (req) => {
    const { listId } = parse(listParams, req.params);
    const { retailer: r } = parse(z.object({ retailer: retailer.optional() }), req.query);
    const list = await findList(req.membership!.workspaceId, listId);
    const target = r ?? list.preferredRetailer;
    if (!target) throw badRequest("retailer_required", "Pick a store");
    if (target === "kroger" || target === "instacart") {
      throw new HttpError(501, "not_yet", "Sending lists to Kroger and Instacart is coming soon");
    }
    const items = await p.shoppingItem.findMany({ where: { shoppingListId: list.id, checkedAt: null }, orderBy: { position: "asc" } });
    return buildHandoff(target, items);
  });
}

/** userId → the name people know them by here (their participant), else their email's name part. */
async function displayNames(app: FastifyInstance, workspaceId: string): Promise<Map<string, string>> {
  const ms = await app.prisma.workspaceMembership.findMany({
    where: { workspaceId },
    include: { participant: { select: { name: true } }, user: { select: { email: true } } },
  });
  return new Map(ms.map((m) => [m.userId, m.participant?.name ?? m.user.email.split("@")[0]!]));
}
