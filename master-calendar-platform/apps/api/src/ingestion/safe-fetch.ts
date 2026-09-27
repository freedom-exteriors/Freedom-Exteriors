// Fetching user-supplied calendar URLs without SSRF: a feed URL is attacker-controlled
// input, and a naive fetch would happily read http://169.254.169.254/ (cloud metadata),
// localhost admin ports, or the private network.
//
// Defenses: http(s) only (webcal:// → https://); IP literals checked up front; every DNS
// answer checked *at connect time* (so DNS rebinding can't swap in a private IP after
// validation); redirects followed manually and re-checked; timeout; size cap; and the
// response must actually be an iCalendar document.
import dns from "node:dns";
import net from "node:net";
import { Agent, fetch } from "undici";

export class FeedError extends Error {}

const blocked = new net.BlockList();
for (const [addr, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16],
  ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15],
  ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
] as const) blocked.addSubnet(addr, prefix, "ipv4");
for (const [addr, prefix] of [["::", 128], ["::1", 128], ["fc00::", 7], ["fe80::", 10], ["ff00::", 8], ["2001:db8::", 32]] as const) {
  blocked.addSubnet(addr, prefix, "ipv6");
}

export function isBlockedAddress(address: string): boolean {
  const family = net.isIP(address);
  if (family === 4) return blocked.check(address, "ipv4");
  if (family === 6) {
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
    if (mapped) return blocked.check(mapped[1]!, "ipv4");
    return blocked.check(address, "ipv6");
  }
  return true; // not an IP at all → don't connect
}

/** Normalizes and checks a feed URL's shape. Throws FeedError with a user-facing message. */
export function normalizeFeedUrl(input: string): URL {
  let url: URL;
  try {
    url = new URL(input.trim().replace(/^webcals?:\/\//i, "https://"));
  } catch {
    throw new FeedError("That doesn't look like a link");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new FeedError("Calendar links must start with https:// or webcal://");
  if (url.username || url.password) throw new FeedError("Put the username and password in their own fields, not in the link");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (net.isIP(host) && isBlockedAddress(host)) throw new FeedError("That address isn't reachable from here");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal") || host.endsWith(".local")) {
    throw new FeedError("That address isn't reachable from here");
  }
  return url;
}

/** Exported for tests. */
export const safeLookup: net.LookupFunction = (hostname, options, callback) => {
  dns.lookup(hostname, { all: true }, (err, addresses) => {
    if (err) return callback(err, "", 4);
    const bad = addresses.find((a) => isBlockedAddress(a.address));
    if (bad || addresses.length === 0) {
      return callback(Object.assign(new Error("Blocked address"), { code: "EBLOCKED" }), "", 4);
    }
    if ((options as { all?: boolean }).all) return (callback as unknown as (e: null, a: dns.LookupAddress[]) => void)(null, addresses);
    callback(null, addresses[0]!.address, addresses[0]!.family);
  });
};

const agent = new Agent({ connect: { lookup: safeLookup }, headersTimeout: 15_000, bodyTimeout: 15_000 });

export interface FeedRequest {
  etag?: string | null;
  lastModified?: string | null;
  auth?: { username: string; password: string } | null;
}

export type FeedResponse =
  | { status: "not_modified" }
  | { status: "ok"; body: string; etag: string | null; lastModified: string | null };

export type FeedFetcher = (url: string, req?: FeedRequest) => Promise<FeedResponse>;

const MAX_BYTES = 5 * 1024 * 1024;
const MAX_REDIRECTS = 3;

export const fetchFeed: FeedFetcher = async (rawUrl, req = {}) => {
  let url = normalizeFeedUrl(rawUrl);
  const headers: Record<string, string> = {
    "User-Agent": "HomeBaseCalendar/0.1 (calendar subscription)",
    Accept: "text/calendar, text/plain;q=0.8, */*;q=0.5",
  };
  if (req.etag) headers["If-None-Match"] = req.etag;
  if (req.lastModified) headers["If-Modified-Since"] = req.lastModified;
  const authHeader = req.auth
    ? `Basic ${Buffer.from(`${req.auth.username}:${req.auth.password}`).toString("base64")}`
    : null;
  const originalHost = url.host;

  for (let hop = 0; ; hop++) {
    let res;
    try {
      res = await fetch(url, {
        dispatcher: agent,
        redirect: "manual",
        signal: AbortSignal.timeout(20_000),
        // Credentials only go to the host the user gave us, never to a redirect target.
        headers: authHeader && url.host === originalHost ? { ...headers, Authorization: authHeader } : headers,
      });
    } catch (err) {
      const cause = (err as { cause?: { code?: string } }).cause;
      if (cause?.code === "EBLOCKED") throw new FeedError("That address isn't reachable from here");
      if (cause?.code === "ENOTFOUND") throw new FeedError("Couldn't find that website");
      throw new FeedError("Couldn't reach that calendar (timed out or refused)");
    }
    if (res.status >= 300 && res.status < 400 && res.status !== 304) {
      const location = res.headers.get("location");
      await res.body?.cancel();
      if (!location || hop >= MAX_REDIRECTS) throw new FeedError("Too many redirects");
      url = normalizeFeedUrl(new URL(location, url).toString());
      continue;
    }
    if (res.status === 304) return { status: "not_modified" };
    if (res.status === 401 || res.status === 403) throw new FeedError("That calendar needs a username and password (or the link has expired)");
    if (res.status === 404 || res.status === 410) throw new FeedError("That calendar link no longer exists");
    if (!res.ok) throw new FeedError(`The calendar server returned an error (${res.status})`);

    const body = await readCapped(res.body);
    if (!/BEGIN:VCALENDAR/i.test(body.slice(0, 4096))) {
      throw new FeedError("That link is a web page, not a calendar feed. Look for “Subscribe”, “iCal” or “.ics”.");
    }
    return { status: "ok", body, etag: res.headers.get("etag"), lastModified: res.headers.get("last-modified") };
  }
};

async function readCapped(stream: { getReader(): ReadableStreamDefaultReader<Uint8Array> } | null): Promise<string> {
  if (!stream) return "";
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BYTES) {
      await reader.cancel();
      throw new FeedError("That calendar is too large (over 5 MB)");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}
