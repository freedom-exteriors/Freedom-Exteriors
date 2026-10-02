import { NextResponse, type NextRequest } from "next/server";
import { validateInvoiceInput } from "@/lib/invoice";
import { createGeneratedInvoice, listInvoices, parseFilters } from "@/lib/invoices.server";
import { jsonError, readJson, serverError } from "@/lib/http";

export async function GET(req: NextRequest) {
  try {
    const rows = await listInvoices(parseFilters(req.nextUrl.searchParams));
    return NextResponse.json({ invoices: rows });
  } catch (e) {
    return serverError(e, "list invoices");
  }
}

// Create a generated invoice. Totals are recomputed here from the line
// items; nothing the browser calculated is used.
export async function POST(req: NextRequest) {
  const parsed = validateInvoiceInput(await readJson(req), "generated");
  if (!parsed.ok) return jsonError(parsed.errors.join(" "), 400, { errors: parsed.errors });
  try {
    const result = await createGeneratedInvoice(parsed.value);
    return NextResponse.json(result, { status: 201 });
  } catch (e) {
    return serverError(e, "create invoice");
  }
}
