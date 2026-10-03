import { NextResponse, type NextRequest } from "next/server";
import { CrmError, InvoiceLockedError, setStatus } from "@/lib/invoices.server";
import { isUuid, jsonError, readJson, serverError } from "@/lib/http";
import { isIsoDate, todayIso } from "@/lib/dates";

// Body: { status: "paid" | "outstanding" | "void", paidDate?: "YYYY-MM-DD" }
export async function POST(req: NextRequest, ctx: RouteContext<"/api/invoices/[id]/status">) {
  const { id } = await ctx.params;
  if (!isUuid(id)) return jsonError("Not found", 404);
  const body = (await readJson(req)) as { status?: unknown; paidDate?: unknown } | null;
  const status = body?.status;
  if (status !== "paid" && status !== "outstanding" && status !== "void") return jsonError("Unknown status");
  const paidDate = isIsoDate(body?.paidDate) ? (body!.paidDate as string) : todayIso();
  try {
    const row = await setStatus(id, status, status === "paid" ? paidDate : null);
    if (!row) return jsonError("Not found", 404);
    return NextResponse.json(row);
  } catch (e) {
    if (e instanceof InvoiceLockedError) return jsonError(e.message, 409);
    if (e instanceof CrmError) return jsonError(`Not marked paid: QuickBooks didn't record the payment (${e.message}).`, 502);
    return serverError(e, "set status");
  }
}
