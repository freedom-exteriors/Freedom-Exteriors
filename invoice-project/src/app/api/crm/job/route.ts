import { NextResponse, type NextRequest } from "next/server";
import { crmCall, CrmError, type CrmJob } from "@/lib/crm.server";
import { jsonError, serverError } from "@/lib/http";

// A CRM job's customer details, for pre-filling a new estimate or invoice
// opened from the CRM (…/new?crmJob=<id>).
export async function GET(req: NextRequest) {
  const id = Number(req.nextUrl.searchParams.get("id"));
  if (!Number.isSafeInteger(id) || id <= 0) return jsonError("Missing CRM job", 400);
  try {
    const { job } = await crmCall<{ job: CrmJob }>("tool-job", { jobId: id });
    return NextResponse.json({ job });
  } catch (e) {
    if (e instanceof CrmError) return jsonError(e.message, e.status === 404 ? 404 : 502);
    return serverError(e, "crm job");
  }
}
