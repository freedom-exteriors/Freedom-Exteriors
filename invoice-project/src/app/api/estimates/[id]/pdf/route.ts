import type { NextRequest } from "next/server";
import { loadEstimate } from "@/lib/estimates.server";
import { docxFromEstimate } from "@/lib/docx/fromEstimate";
import { buildEstimatePdf } from "@/lib/pdf/buildPdf";
import { pdfResponse } from "@/lib/pdf/response";
import { isUuid, jsonError, serverError } from "@/lib/http";

// The estimate as a PDF, built fresh from the saved data.
export async function GET(req: NextRequest, ctx: RouteContext<"/api/estimates/[id]/pdf">) {
  const { id } = await ctx.params;
  if (!isUuid(id)) return jsonError("Not found", 404);
  try {
    const est = await loadEstimate(id);
    if (!est) return jsonError("Not found", 404);
    const buf = await buildEstimatePdf(docxFromEstimate(est));
    return pdfResponse(buf, `${est.estimate_number}.pdf`, req.nextUrl.searchParams.get("download") === "1");
  } catch (e) {
    return serverError(e, "estimate pdf");
  }
}
