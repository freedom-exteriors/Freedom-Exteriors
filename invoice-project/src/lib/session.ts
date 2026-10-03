// Signed session cookie. Uses Web Crypto so it works in proxy.ts and in
// route handlers alike.
//
// Cookie value: "<issuedAtMs>.<hex HMAC-SHA256>". The HMAC covers the issue
// time AND a fingerprint of APP_PASSWORD, so changing the password (or
// SESSION_SECRET) logs everyone out.

export const SESSION_COOKIE = "fe_invoice_session";
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 14; // 14 days

const enc = new TextEncoder();

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return toHex(await crypto.subtle.sign("HMAC", key, enc.encode(message)));
}

async function sha256Hex(s: string): Promise<string> {
  return toHex(await crypto.subtle.digest("SHA-256", enc.encode(s)));
}

function secrets() {
  const secret = process.env.SESSION_SECRET ?? "";
  const password = process.env.APP_PASSWORD ?? "";
  if (secret.length < 32 || password.length < 8) return null;
  return { secret, password };
}

/** Constant-time comparison of two equal-length hex strings. */
export function safeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function createSessionToken(now = Date.now()): Promise<string> {
  const s = secrets();
  if (!s) throw new Error("APP_PASSWORD or SESSION_SECRET is not configured");
  const issued = String(now);
  const sig = await hmacHex(s.secret, `${issued}|${await sha256Hex(s.password)}`);
  return `${issued}.${sig}`;
}

export async function verifySessionToken(token: string | undefined | null, now = Date.now()): Promise<boolean> {
  const s = secrets();
  if (!s || !token) return false;
  const dot = token.indexOf(".");
  if (dot <= 0) return false;
  const issued = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  if (!/^\d{10,16}$/.test(issued) || !/^[0-9a-f]{64}$/.test(sig)) return false;
  const age = now - Number(issued);
  if (age < 0 || age > SESSION_MAX_AGE_SECONDS * 1000) return false;
  const expected = await hmacHex(s.secret, `${issued}|${await sha256Hex(s.password)}`);
  return safeEqualHex(sig, expected);
}

/** Compare a typed password to APP_PASSWORD without leaking timing. */
export async function passwordMatches(typed: string): Promise<boolean> {
  const s = secrets();
  if (!s) return false;
  const [a, b] = await Promise.all([sha256Hex(typed), sha256Hex(s.password)]);
  return safeEqualHex(a, b);
}
