import { test } from "node:test";
import assert from "node:assert/strict";
import { Client, makeApp, prisma } from "./helpers.js";

/** A family with an owner, and a kid (viewer) whose login is participant "Maya". */
async function household() {
  const app = await makeApp();
  const parent = new Client(app);
  const { workspaceId } = await parent.signup(`l-parent-${crypto.randomUUID().slice(0, 6)}`, { name: "List Family", vertical: "family" });
  const ws = workspaceId!;
  const maya = (await parent.post(`/workspaces/${ws}/participants`, { name: "Maya" })).json();
  const kid = new Client(app);
  await kid.signup(`l-kid-${crypto.randomUUID().slice(0, 6)}`);
  const { token } = (await parent.post(`/workspaces/${ws}/invites`, { role: "viewer", participantId: maya.id })).json();
  await kid.post(`/invites/${token}/accept`);
  const lists = (await parent.get(`/workspaces/${ws}/task-lists`)).json() as { id: string; key: string }[];
  const shopping = (await parent.get(`/workspaces/${ws}/shopping-lists`)).json();
  return {
    app, parent, kid, ws, maya,
    honeyDo: lists.find((l) => l.key === "honey_do")!.id,
    chores: lists.find((l) => l.key === "chores")!.id,
    groceries: shopping.lists.find((l: { key: string }) => l.key === "groceries").id as string,
    categories: shopping.categories as string[],
  };
}

test("tasks: parents manage; kids add to open lists and tick off their own chores", async () => {
  const h = await household();
  const T = `/workspaces/${h.ws}/tasks`;

  const fix = await h.parent.post(T, { title: "Fix hinge", taskListId: h.honeyDo, estimatedMinutes: 20, priority: "low" });
  assert.equal(fix.statusCode, 201);
  assert.equal(fix.json().estimatedMinutes, 20);

  // Kid adds to Chores (open to viewers) — but can't set who/when/priority.
  const kidTask = await h.kid.post(T, { title: "Clean hamster cage", taskListId: h.chores, priority: "high", assignedParticipantId: h.maya.id });
  assert.equal(kidTask.statusCode, 201);
  assert.equal(kidTask.json().priority, "normal");
  assert.equal(kidTask.json().assignedParticipant, null);
  // Honey-do is open to viewers in the family template; a private list isn't.
  const priv = (await h.parent.post(`/workspaces/${h.ws}/task-lists`, { name: "Gift ideas" })).json();
  assert.equal((await h.kid.post(T, { title: "peek", taskListId: priv.id })).statusCode, 403);
  assert.equal((await h.kid.post(T, { title: "no list" })).statusCode, 403);

  // Maya's own chore on the private list: she may tick it off, not edit it.
  const chore = (await h.parent.post(T, { title: "Wrap presents", taskListId: priv.id, assignedParticipantId: h.maya.id })).json();
  assert.equal((await h.kid.patch(`${T}/${chore.id}`, { title: "nah" })).statusCode, 403);
  const done = await h.kid.patch(`${T}/${chore.id}`, { completed: true });
  assert.equal(done.statusCode, 200);
  assert.ok(done.json().completedAt);
  assert.match(done.json().completedBy, /l-kid-/);

  // Kids can delete what they added, not what others did.
  assert.equal((await h.kid.del(`${T}/${fix.json().id}`)).statusCode, 403);
  assert.equal((await h.kid.del(`${T}/${kidTask.json().id}`)).statusCode, 204);

  const open = (await h.parent.get(`${T}?taskListId=${h.honeyDo}`)).json();
  assert.deepEqual(open.map((t: { title: string }) => t.title), ["Fix hinge"]);
  const lists = (await h.parent.get(`/workspaces/${h.ws}/task-lists`)).json();
  assert.equal(lists.find((l: { id: string }) => l.id === h.honeyDo).openCount, 1);
  // Foreign references are rejected.
  const other = await household();
  assert.equal((await h.parent.post(T, { title: "x", taskListId: other.honeyDo })).statusCode, 400);
  assert.equal((await h.parent.patch(`${T}/${fix.json().id}`, { assignedParticipantId: other.maya.id })).statusCode, 400);
});

test("shopping: walking order, dedupe, staples, clear & restock, who added it", async () => {
  const h = await household();
  const L = `/workspaces/${h.ws}/shopping-lists/${h.groceries}/items`;
  assert.equal((await h.kid.post(L, { name: "Bananas", category: "Produce" })).statusCode, 201);
  const milk = (await h.parent.post(L, { name: "Milk", category: "Dairy & eggs", isStaple: true })).json();
  await h.parent.post(L, { name: "Birthday candles" });
  await h.parent.post(L, { name: "Eggs", category: "Dairy & eggs" });
  await h.kid.post(L, { name: "Chips", category: "Snacks" });

  const again = await h.kid.post(L, { name: "milk" });
  assert.equal(again.statusCode, 200);
  assert.equal(again.json().merged, true);

  let items = (await h.parent.get(L)).json().items;
  // Template order: Produce … Dairy & eggs … Snacks, uncategorized last.
  assert.deepEqual(items.map((i: { name: string }) => i.name), ["Bananas", "Milk", "Eggs", "Chips", "Birthday candles"]);
  assert.equal(items[0].addedBy, "Maya");

  const bananas = items[0];
  await h.kid.patch(`${L}/${bananas.id}`, { checked: true });
  await h.parent.patch(`${L}/${milk.id}`, { checked: true });
  items = (await h.parent.get(L)).json().items;
  assert.deepEqual(items.slice(-2).map((i: { name: string; checked: boolean }) => [i.name, i.checked]), [["Bananas", true], ["Milk", true]]);
  assert.equal(items.find((i: { name: string }) => i.name === "Bananas").checkedBy, "Maya");

  assert.equal((await h.kid.post(`/workspaces/${h.ws}/shopping-lists/${h.groceries}/clear-checked`)).statusCode, 403, "parents clear");
  assert.deepEqual((await h.parent.post(`/workspaces/${h.ws}/shopping-lists/${h.groceries}/clear-checked`)).json(), { removed: 1 });
  // Re-adding a bought staple just puts it back.
  const back = await h.kid.post(L, { name: "Milk" });
  assert.equal(back.json().merged, true);
  assert.equal(back.json().checked, false);
  await h.parent.patch(`${L}/${milk.id}`, { checked: true });
  assert.deepEqual((await h.kid.post(`/workspaces/${h.ws}/shopping-lists/${h.groceries}/restock-staples`)).json(), { restocked: 1 });

  const other = await household();
  assert.equal((await other.parent.get(L)).statusCode, 404);
});

test("retailer handoff links", async () => {
  const h = await household();
  const L = `/workspaces/${h.ws}/shopping-lists/${h.groceries}`;
  const saved = await h.parent.post(`${L}/items`, { name: "HVAC filter 20x25x1", quantity: "4", retailerRefs: { amazon: { asin: "B000TEST01" }, target: { tcin: "12345678" } } });
  assert.equal(saved.statusCode, 201, saved.body);
  assert.equal((await h.parent.post(`${L}/items`, { name: "Only Amazon", retailerRefs: { amazon: { asin: "B000TEST02" } } })).statusCode, 201, "one retailer is enough");
  await h.parent.del(`${L}/items/${(await h.parent.get(`${L}/items`)).json().items.find((i: { name: string }) => i.name === "Only Amazon").id}`);
  await h.parent.post(`${L}/items`, { name: "Paper towels" });

  const amazon = (await h.parent.get(`${L}/handoff?retailer=amazon`)).json();
  assert.equal(amazon.cartUrl, "https://www.amazon.com/gp/aws/cart/add.html?ASIN.1=B000TEST01&Quantity.1=4");
  assert.deepEqual(amazon.items.map((i: { kind: string }) => i.kind), ["cart", "search"]);
  assert.equal(amazon.items[1].url, "https://www.amazon.com/s?k=Paper%20towels");

  const target = (await h.parent.get(`${L}/handoff?retailer=target`)).json();
  assert.equal(target.items[0].url, "https://www.target.com/p/-/A-12345678");
  assert.equal(target.items[1].url, "https://www.target.com/s?searchTerm=Paper%20towels");

  assert.equal((await h.parent.get(`${L}/handoff?retailer=kroger`)).statusCode, 501);
  assert.equal((await h.parent.get(`${L}/handoff`)).statusCode, 400, "no preferred store set");
  // Junk in retailer refs is never pasted into a URL.
  await h.parent.post(`${L}/items`, { name: "Sketchy", retailerRefs: { amazon: { asin: "../../evil?x=" } } });
  assert.ok(!JSON.stringify((await h.parent.get(`${L}/handoff?retailer=amazon`)).json()).includes("evil"));
});
