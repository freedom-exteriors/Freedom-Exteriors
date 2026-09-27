// Shapes of the API responses the UI uses (see apps/api/src/routes).
export type Role = "owner" | "member" | "viewer";
export interface Person { id: string; name: string; color: string }
export interface Tag { id: string; key: string; label: string; color: string | null }

export interface Me {
  user: { id: string; email: string };
  workspaces: { id: string; name: string; vertical: string; kind: "home" | "circle"; role: Role; participantId: string | null }[];
}

export interface WorkspaceDetail {
  id: string;
  name: string;
  vertical: "family" | "student" | "business";
  kind: "home" | "circle";
  timeZone: string;
  myRole: Role;
  myParticipantId: string | null;
  participants: (Person & { canDrive: boolean; linkedWorkspaceId: string | null })[];
  tags: Tag[];
  labels: { workspace: string; participant: string; participantPlural: string; contact: string };
  contactRoles: string[];
  shoppingCategories: string[];
}

export interface CalEvent {
  id: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  location: string | null;
  description: string | null;
  url: string | null;
  participant: Person | null;
  unassigned: boolean;
  tag: Tag | null;
  driver: { id: string; name: string } | null;
  needsDriver: boolean;
  place: { id: string; name: string } | null;
  source: { id: string; name: string | null; type: string };
  circle: { id: string; name: string } | null;
  editable: boolean;
}

export interface Task {
  id: string;
  title: string;
  notes: string | null;
  priority: "low" | "normal" | "high";
  dueAt: string | null;
  completedAt: string | null;
  estimatedMinutes: number | null;
  locationKind: "home" | "errand" | "anywhere";
  taskListId: string | null;
  assignedParticipant: Person | null;
  scheduledParticipant: Person | null;
  scheduledStart: string | null;
  scheduledEnd: string | null;
  scheduleStatus: "suggested" | "accepted" | null;
  scheduleReason: string | null;
  createdBy: string | null;
  completedBy: string | null;
  event: { id: string; title: string; startTime: string } | null;
  place: { id: string; name: string } | null;
}

export interface TaskList { id: string; key: string | null; name: string; viewerCanAdd: boolean; openCount: number }
export interface ShoppingList { id: string; key: string | null; name: string; viewerCanAdd: boolean; preferredRetailer: string | null; openCount: number; place: { id: string; name: string } | null }
export interface ShoppingItem { id: string; name: string; quantity: string | null; category: string | null; isStaple: boolean; checked: boolean; addedBy: string | null; checkedBy: string | null }

export interface Goal {
  id: string;
  title: string;
  description: string | null;
  horizon: "short_term" | "long_term";
  status: "active" | "achieved" | "dropped";
  targetDate: string | null;
  participant: Person | null;
  milestones: { id: string; title: string; completedAt: string | null; assignedParticipant: Person | null }[];
  progress: { done: number; total: number; percent: number };
}

export interface Candidate {
  id: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  location: string | null;
  confidence: number;
  lowConfidence: boolean;
  participantId: string | null;
  eventTagId: string | null;
  sourceText: string;
  assumptions: string[];
  status: "pending" | "confirmed" | "rejected";
  edited?: boolean;
}

export interface Photo {
  id: string;
  status: "pending" | "processing" | "completed" | "failed";
  errorMessage: string | null;
  createdAt: string;
  uploadedBy: string | null;
  imageUrl: string;
  notes: string | null;
  counts: { pending: number; confirmed: number; rejected: number };
  candidates?: Candidate[];
}

export interface Notification { id: string; workspaceId: string; kind: string; title: string; body: string; url: string | null; readAt: string | null; createdAt: string }
