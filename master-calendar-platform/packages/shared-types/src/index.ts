// Types shared by apps/api and apps/web. Kept free of Prisma imports so the web bundle
// never pulls in the DB client.

export type WorkspaceVertical = "family" | "student" | "business";
export type MembershipRole = "owner" | "member" | "viewer";
export type ActionType = "create_reminder" | "flag_unassigned_task";

/** One photo-extraction candidate, stored in UploadedScheduleImage.extractedEvents until confirmed. */
export interface ExtractedEventCandidate {
  title: string;
  start: string; // ISO-8601
  end: string | null;
  location: string | null;
  confidence: number; // 0..1
}
