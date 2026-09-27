// Pulls one ICS feed into Event rows. Diff/apply rules live in apply.ts.
import type { PrismaClient } from "@mcp/db";
import type { Crypter } from "../lib/crypto.js";
import { FeedError, type FeedFetcher } from "./safe-fetch.js";
import { parseIcs } from "./ics-parser.js";
import { applyOccurrences, markSynced, syncWindow, type SyncStats } from "./apply.js";

export interface IcsSyncDeps {
  fetchFeed: FeedFetcher;
  crypter: Crypter | null;
  now?: () => Date;
}

export async function syncIcsSource(prisma: PrismaClient, sourceId: string, deps: IcsSyncDeps): Promise<SyncStats> {
  const now = deps.now?.() ?? new Date();
  const source = await prisma.calendarSource.findUniqueOrThrow({ where: { id: sourceId }, include: { workspace: true } });
  if (source.type !== "ics_feed" || !source.feedUrl) throw new FeedError("This source isn't a calendar feed");

  let auth = null;
  if (source.feedUsernameEnc && source.feedPasswordEnc) {
    if (!deps.crypter) throw new FeedError("Server is missing CREDENTIALS_ENCRYPTION_KEY");
    auth = { username: deps.crypter.decrypt(source.feedUsernameEnc), password: deps.crypter.decrypt(source.feedPasswordEnc) };
  }

  const res = await deps.fetchFeed(source.feedUrl, { etag: source.httpEtag, lastModified: source.httpLastModified, auth });
  if (res.status === "not_modified") {
    const stats: SyncStats = { created: 0, updated: 0, deleted: 0, unchanged: 0, notModified: true };
    await markSynced(prisma, sourceId, now, stats);
    return stats;
  }

  const window = syncWindow(now);
  const occurrences = parseIcs(res.body, { timeZone: source.workspace.timeZone, ...window });
  const stats = await applyOccurrences(prisma, source, occurrences, window);
  await markSynced(prisma, sourceId, now, stats, { httpEtag: res.etag, httpLastModified: res.lastModified });
  return stats;
}
