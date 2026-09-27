// Static seed data per workspace flavor. This is the ONLY place verticals differ — the
// engine never branches on vertical or kind. Adding a vertical = add a JSON file + an
// enum value.
import type { ActionType, Retailer, WorkspaceKind, WorkspaceVertical } from "@mcp/shared-types";
import family from "./family.json" with { type: "json" };
import student from "./student.json" with { type: "json" };
import business from "./business.json" with { type: "json" };
import circle from "./circle.json" with { type: "json" };

export type TemplateId = WorkspaceVertical | "circle";

export interface WorkspaceTemplate {
  id: TemplateId;
  labels: {
    workspace: string;
    participant: string;
    participantPlural: string;
    contact: string;
  };
  eventTags: { key: string; label: string; color: string }[];
  /** Suggested Contact.role values for the UI's role picker — not enforced. */
  contactRoles: string[];
  automationRules: {
    tagKey: string;
    timingOffsetMinutes: number;
    actionType: ActionType;
    actionPayload: Record<string, unknown>;
  }[];
  taskLists: { key: string; name: string; viewerCanAdd: boolean }[];
  shoppingLists: { key: string; name: string; preferredRetailer: Retailer | null }[];
  /** Suggested ShoppingItem.category values (store sections), in shopping-trip order. */
  shoppingCategories: string[];
  /** Seasonal/recurring reminders; users can edit dates, disable, or delete them. */
  recurringReminders: {
    title: string;
    category: string;
    rrule: string;
    leadDays: number;
    taskListKey: string | null;
  }[];
}

export const workspaceTemplates: Record<TemplateId, WorkspaceTemplate> = {
  family: family as WorkspaceTemplate,
  student: student as WorkspaceTemplate,
  business: business as WorkspaceTemplate,
  circle: circle as WorkspaceTemplate,
};

/** Circles share one template whatever their vertical; homes use their vertical's. */
export function getWorkspaceTemplate(kind: WorkspaceKind, vertical: WorkspaceVertical): WorkspaceTemplate {
  return workspaceTemplates[kind === "circle" ? "circle" : vertical];
}
