import { test } from "node:test";
import assert from "node:assert/strict";
import rrulePkg from "rrule";
import { workspaceTemplates } from "../seed-templates/index.js";

const { RRule } = rrulePkg;
const RETAILERS = ["amazon", "target", "walmart", "kroger", "instacart"];

for (const [vertical, t] of Object.entries(workspaceTemplates)) {
  test(`${vertical} template is internally consistent`, () => {
    assert.equal(t.id, vertical);
    const keys = t.eventTags.map((x) => x.key);
    assert.equal(new Set(keys).size, keys.length, "duplicate tag keys");
    for (const k of keys) assert.match(k, /^[a-z][a-z0-9_]*$/);
    for (const r of t.automationRules) assert.ok(keys.includes(r.tagKey), `rule references unknown tag ${r.tagKey}`);
    assert.ok(t.automationRules.some((r) => r.actionType === "flag_unassigned_task"), "needs an unassigned-event rule");
    assert.ok(t.contactRoles.length > 0);
    assert.ok(t.shoppingCategories.length > 0);

    for (const lists of [t.taskLists, t.shoppingLists]) {
      const listKeys = lists.map((l) => l.key);
      assert.equal(new Set(listKeys).size, listKeys.length, "duplicate list keys");
    }
    for (const l of t.shoppingLists) {
      assert.ok(l.preferredRetailer === null || RETAILERS.includes(l.preferredRetailer));
    }

    const taskListKeys = t.taskLists.map((l) => l.key);
    for (const r of t.recurringReminders) {
      assert.ok(r.taskListKey === null || taskListKeys.includes(r.taskListKey), `reminder "${r.title}" targets unknown list`);
      assert.ok(r.leadDays >= 0);
      // Every rule must parse and produce a next occurrence without a DTSTART.
      const rule = new RRule({ ...RRule.parseString(r.rrule), dtstart: new Date("2026-01-01T00:00:00Z") });
      assert.ok(rule.after(new Date("2026-06-01T00:00:00Z")), `rrule "${r.rrule}" never fires`);
    }
  });
}
