// Static per-vertical seed data. This is the ONLY place verticals differ — the engine
// never branches on vertical. Adding a vertical = add a JSON file + an enum value.
import type { ActionType, WorkspaceVertical } from "@mcp/shared-types";
import family from "./family.json" with { type: "json" };
import student from "./student.json" with { type: "json" };
import business from "./business.json" with { type: "json" };

export interface VerticalTemplate {
  vertical: WorkspaceVertical;
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
}

export const verticalTemplates: Record<WorkspaceVertical, VerticalTemplate> = {
  family: family as VerticalTemplate,
  student: student as VerticalTemplate,
  business: business as VerticalTemplate,
};

export function getVerticalTemplate(vertical: WorkspaceVertical): VerticalTemplate {
  return verticalTemplates[vertical];
}
