import { NextResponse, type NextRequest } from "next/server";
import { validateInvoiceInput } from "@/lib/invoice";
import { createGeneratedInvoice, listInvoices, parseFilters } from "@/lib/invoices.server";
import { linkInvoiceToEstimate } from "@/lib/estimates.server";
import { isUuid, jsonError, readJson, serverError } from "@/lib/http";
import { todayIso } from "@/lib/dates";

export async function GET(req: NextRequest) {
  try {
    const rows = await listInvoices(parseFilters(req.nextUrl.searchParams));
    return NextResponse.json({ invoices: rows });
  } catch (e) {
    return serverError(e, "list invoices");
  }
}

// Create a generated invoice. Totals are recomputed here from the line
// items; nothing the browser calculated is used. `fromEstimateId` (set by
// "Make invoice") marks that estimate Accepted and links it to this invoice.
export async function POST(req: NextRequest) {
  const body = await readJson(req);
  const parsed = validateInvoiceInput(body, "generated");
  if (!parsed.ok) return jsonError(parsed.errors.join(" "), 400, { errors: parsed.errors });
  try {
    const result = await createGeneratedInvoice(parsed.value);
    const fromEstimateId = (body as { fromEstimateId?: unknown } | null)?.fromEstimateId;
    if (typeof fromEstimateId === "string" && isUuid(fromEstimateId)) {
      try {
        await linkInvoiceToEstimate(fromEstimateId, result.id, todayIso());
      } catch (e) {
        console.error("[link estimate]", e); // the invoice itself is saved
      }
    }
    return NextResponse.json(result, { status: 201 });
  } catch (e) {
    return serverError(e, "create invoice");
  }
}
