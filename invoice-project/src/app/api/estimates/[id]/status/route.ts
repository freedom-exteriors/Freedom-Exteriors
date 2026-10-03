import { NextResponse, type NextRequest } from "next/server";
import { ESTIMATE_STATUSES, type EstimateStatus } from "@/lib/estimate";
import { EstimateLockedError, setEstimateStatus } from "@/lib/estimates.server";
import { isUuid, jsonError, readJson, serverError } from "@/lib/http";
import { todayIso } from "@/lib/dates";

// Body: { status: "draft" | "sent" | "accepted" | "declined" | "void" }
export async function POST(req: NextRequest, ctx: RouteContext<"/api/estimates/[id]/status">) {
  const { id } = await ctx.params;
  if (!isUuid(id)) return jsonError("Not found", 404);
  const body = (await readJson(req)) as { status?: unknown } | null;
  const status = body?.status;
  if (!ESTIMATE_STATUSES.includes(status as EstimateStatus)) return jsonError("Unknown status");
  try {
    const row = await setEstimateStatus(id, status as EstimateStatus, todayIso());
    if (!row) return jsonError("Not found", 404);
    return NextResponse.json(row);
  } catch (e) {
    if (e instanceof EstimateLockedError) return jsonError(e.message, 409);
    return serverError(e, "estimate status");
  }
}
