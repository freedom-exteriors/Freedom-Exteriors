import { test } from "node:test";
import assert from "node:assert/strict";
import { verticalTemplates } from "../seed-templates/index.js";

for (const [vertical, t] of Object.entries(verticalTemplates)) {
  test(`${vertical} template is internally consistent`, () => {
    assert.equal(t.vertical, vertical);
    const keys = t.eventTags.map((x) => x.key);
    assert.equal(new Set(keys).size, keys.length, "duplicate tag keys");
    for (const k of keys) assert.match(k, /^[a-z][a-z0-9_]*$/);
    for (const r of t.automationRules) assert.ok(keys.includes(r.tagKey), `rule references unknown tag ${r.tagKey}`);
    assert.ok(t.automationRules.some((r) => r.actionType === "flag_unassigned_task"), "needs an unassigned-event rule");
    assert.ok(t.contactRoles.length > 0);
  });
}
