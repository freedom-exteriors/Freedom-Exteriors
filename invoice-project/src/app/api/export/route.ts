import { type NextRequest } from "next/server";
import { buildCsv } from "@/lib/csv";
import { lineItemsFor, listInvoices, parseFilters } from "@/lib/invoices.server";
import { serverError } from "@/lib/http";
import { todayIso } from "@/lib/dates";

// CSV of the catalog with the SAME filters as the screen.
export async function GET(req: NextRequest) {
  try {
    const invoices = await listInvoices(parseFilters(req.nextUrl.searchParams), 10_000);
    const items = await lineItemsFor(invoices.map((i) => i.id));
    const csv = buildCsv(invoices.map((invoice) => ({ invoice, items: items.get(invoice.id) ?? [] })));
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="invoices-${todayIso()}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    return serverError(e, "export");
  }
}
