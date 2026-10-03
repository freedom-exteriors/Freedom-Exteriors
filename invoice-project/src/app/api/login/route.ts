import { NextResponse, type NextRequest } from "next/server";
import { createSessionToken, passwordMatches, SESSION_COOKIE, SESSION_MAX_AGE_SECONDS } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { jsonError, readJson } from "@/lib/http";

const MAX_FAILURES = 5;
const WINDOW_MINUTES = 15;

function clientIp(req: NextRequest): string {
  const fwd = req.headers.get("x-forwarded-for");
  return (fwd?.split(",")[0] ?? req.headers.get("x-real-ip") ?? "unknown").trim().slice(0, 64);
}

export async function POST(req: NextRequest) {
  const body = (await readJson(req)) as { password?: unknown } | null;
  const password = typeof body?.password === "string" ? body.password.slice(0, 200) : "";
  const ip = clientIp(req);
  const db = supabaseAdmin();

  const { data: failures, error } = await db.rpc("recent_login_failures", { p_ip: ip, p_minutes: WINDOW_MINUTES });
  if (error) {
    console.error("[login] rate-limit check failed", error);
    return jsonError("Login is unavailable right now. Try again shortly.", 503);
  }
  if ((failures ?? 0) >= MAX_FAILURES) {
    return jsonError(`Too many wrong passwords. Wait ${WINDOW_MINUTES} minutes and try again.`, 429);
  }

  if (!password || !(await passwordMatches(password))) {
    await db.from("login_attempts").insert({ ip });
    // Also prune old rows so the table stays small.
    await db.from("login_attempts").delete().lt("attempted_at", new Date(Date.now() - 86_400_000).toISOString());
    return jsonError("Wrong password.", 401);
  }

  await db.from("login_attempts").delete().eq("ip", ip);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, await createSessionToken(), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
  return res;
}
