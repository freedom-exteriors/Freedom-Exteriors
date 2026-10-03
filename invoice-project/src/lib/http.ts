import "server-only";
import { NextResponse } from "next/server";

export function jsonError(message: string, status = 400, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ error: message, ...extra }, { status });
}

export async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return null;
  }
}

export function isUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}

/** Log the real error server-side; show the user a plain message. */
export function serverError(err: unknown, context: string) {
  console.error(`[${context}]`, err);
  const message = err instanceof Error ? err.message : "Something went wrong";
  return jsonError(message, 500);
}
