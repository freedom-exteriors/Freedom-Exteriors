// Google Calendar → Event rows. Same diff/apply rules as ICS (apply.ts); Google expands
// recurring series itself (singleEvents=true), and gives each instance a stable
// (recurringEventId, originalStartTime) pair, which becomes our upsert key.
import type { OAuthConnection, PrismaClient } from "@mcp/db";
import { zonedToUtc } from "@mcp/planner";
import type { Crypter } from "../lib/crypto.js";
import { applyOccurrences, markSynced, syncWindow, type Occurrence, type SyncStats } from "../ingestion/apply.js";
import { GoogleApiError, GoogleAuthRevokedError, type GoogleApi, type GoogleEvent, type GoogleEventTime } from "./google-api.js";

/** User-facing Google sync failure. */
export class GoogleSyncError extends Error {}

export interface GoogleSyncDeps {
  google: GoogleApi | null;
  crypter: Crypter | null;
  now?: () => Date;
}

const REFRESH_EARLY_MS = 2 * 60_000;

/** A valid access token for the connection, refreshing (and persisting) it if needed. */
export async function getAccessToken(prisma: PrismaClient, conn: OAuthConnection, deps: GoogleSyncDeps): Promise<string> {
  if (!deps.google || !deps.crypter) throw new GoogleSyncError("Google Calendar isn't set up on this server");
  if (conn.status === "needs_reauth") throw new GoogleSyncError(`Reconnect Google (${conn.accountEmail}) to keep syncing`);
  const now = deps.now?.() ?? new Date();
  if (conn.tokenExpiresAt.getTime() - REFRESH_EARLY_MS > now.getTime()) return deps.crypter.decrypt(conn.accessTokenEnc);

  try {
    const t = await deps.google.refresh(deps.crypter.decrypt(conn.refreshTokenEnc));
    await prisma.oAuthConnection.update({
      where: { id: conn.id },
      data: {
        accessTokenEnc: deps.crypter.encrypt(t.accessToken),
        ...(t.refreshToken ? { refreshTokenEnc: deps.crypter.encrypt(t.refreshToken) } : {}),
        tokenExpiresAt: t.expiresAt,
      },
    });
    return t.accessToken;
  } catch (err) {
    if (err instanceof GoogleAuthRevokedError) {
      await prisma.oAuthConnection.update({ where: { id: conn.id }, data: { status: "needs_reauth" } });
      await prisma.calendarSource.updateMany({
        where: { oauthConnectionId: conn.id },
        data: { lastSyncError: `Google access for ${conn.accountEmail} was removed — reconnect to keep syncing` },
      });
      throw new GoogleSyncError(`Reconnect Google (${conn.accountEmail}) to keep syncing`);
    }
    throw err;
  }
}

export async function syncGoogleSource(prisma: PrismaClient, sourceId: string, deps: GoogleSyncDeps): Promise<SyncStats> {
  const now = deps.now?.() ?? new Date();
  const source = await prisma.calendarSource.findUniqueOrThrow({
    where: { id: sourceId },
    include: { workspace: true, oauthConnection: true },
  });
  if (source.type !== "google" || !source.oauthConnection || !source.externalCalendarId) {
    throw new GoogleSyncError("This isn't a Google calendar");
  }
  const token = await getAccessToken(prisma, source.oauthConnection, deps);
  const window = syncWindow(now);
  let events: GoogleEvent[];
  try {
    events = await deps.google!.listEvents(token, source.externalCalendarId, { timeMin: window.windowStart, timeMax: window.windowEnd });
  } catch (err) {
    if (err instanceof GoogleApiError && (err.status === 404 || err.status === 410)) {
      throw new GoogleSyncError("This Google calendar was deleted or is no longer shared with you");
    }
    if (err instanceof GoogleApiError && (err.status === 401 || err.status === 403)) {
      throw new GoogleSyncError("Google refused access to this calendar — try reconnecting");
    }
    throw err;
  }
  const occurrences = events.flatMap((e) => toOccurrence(e, source.workspace.timeZone) ?? []);
  const stats = await applyOccurrences(prisma, source, occurrences, window);
  await markSynced(prisma, sourceId, now, stats);
  return stats;
}

/** Exported for tests. Returns null for events we don't import. */
export function toOccurrence(e: GoogleEvent, timeZone: string): Occurrence | null {
  if (e.status === "cancelled") return null;
  if (e.eventType === "workingLocation") return null; // "Working from home" markers aren't events
  const allDay = !!e.start.date;
  const startTime = toInstant(e.start, timeZone);
  const endTime = e.end ? toInstant(e.end, timeZone) : startTime;
  return {
    externalUid: e.recurringEventId ?? e.id,
    externalRecurrenceId: e.recurringEventId && e.originalStartTime ? recurrenceKey(e.originalStartTime) : "",
    title: (e.summary || "(no title)").trim().slice(0, 500),
    startTime,
    endTime: endTime < startTime ? startTime : endTime,
    allDay,
    location: e.location?.trim() || null,
    raw: {
      googleEventId: e.id,
      description: e.description?.slice(0, 2000) ?? null,
      url: e.htmlLink ?? null,
      eventType: e.eventType ?? null,
    },
  };
}

function toInstant(t: GoogleEventTime, timeZone: string): Date {
  if (t.dateTime) return new Date(t.dateTime);
  const [y, m, d] = (t.date ?? "").split("-").map(Number);
  return zonedToUtc(y!, m!, d!, 0, timeZone);
}

function recurrenceKey(t: GoogleEventTime): string {
  return t.dateTime ? new Date(t.dateTime).toISOString() : (t.date ?? "");
}

export function isGoogleSyncError(err: unknown): err is GoogleSyncError {
  return err instanceof GoogleSyncError;
}
