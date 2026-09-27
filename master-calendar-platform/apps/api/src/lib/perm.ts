import type { MembershipRole } from "@mcp/db";
import { forbidden } from "./errors.js";

/** Members+ can change anything; viewers only lists opened to them (groceries, chores). */
export function assertCanContribute(role: MembershipRole, list: { viewerCanAdd: boolean }) {
  if (role === "viewer" && !list.viewerCanAdd) throw forbidden("Ask a parent to add to this list");
}

export function assertMember(role: MembershipRole) {
  if (role === "viewer") throw forbidden();
}

/** Next position at the end of a list. */
export function nextPosition(max: number | null | undefined): number {
  return (max ?? -1) + 1;
}
