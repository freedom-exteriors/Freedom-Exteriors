import { NextResponse, type NextRequest } from "next/server";
import { validateEstimateInput } from "@/lib/estimate";
import { createEstimate, listEstimates } from "@/lib/estimates.server";
import { jsonError, readJson, serverError } from "@/lib/http";

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  try {
    return NextResponse.json({ estimates: await listEstimates({ q: sp.get("q") ?? undefined, status: sp.get("status") ?? undefined }) });
  } catch (e) {
    return serverError(e, "list estimates");
  }
}

// Totals are recomputed here from qty × price; nothing the browser
// calculated is used.
export async function POST(req: NextRequest) {
  const parsed = validateEstimateInput(await readJson(req));
  if (!parsed.ok) return jsonError(parsed.errors.join(" "), 400, { errors: parsed.errors });
  try {
    return NextResponse.json(await createEstimate(parsed.value), { status: 201 });
  } catch (e) {
    return serverError(e, "create estimate");
  }
}
