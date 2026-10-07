import { NextResponse, type NextRequest } from "next/server";
import { BUCKET, supabaseAdmin } from "@/lib/supabaseAdmin";
import { validateEstimateInput, type EstimateStatus } from "@/lib/estimate";
import { createUploadedEstimate, EstimateLockedError } from "@/lib/estimates.server";
import { isUploadExt, uploadPaths } from "@/lib/uploads.server";
import { isUuid, jsonError, readJson, serverError } from "@/lib/http";

const STATUSES: Array<Exclude<EstimateStatus, "void">> = ["draft", "sent", "accepted", "declined"];

// Old estimate, step 3: save AFTER Nick has reviewed and corrected the draft.
// Body: { ext, form: EstimateFormInput, documentEstimateNumber: string, status }
export async function POST(req: NextRequest, ctx: RouteContext<"/api/estimates/import/[uploadId]/save">) {
  const { uploadId } = await ctx.params;
  const body = (await readJson(req)) as { ext?: unknown; form?: unknown; documentEstimateNumber?: unknown; status?: unknown } | null;
  if (!isUuid(uploadId) || !isUploadExt(body?.ext)) return jsonError("Not found", 404);
  const status = STATUSES.find((st) => st === body.status);
  if (!status) return jsonError("Pick a status for this estimate.");
  const parsed = validateEstimateInput(body.form);
  if (!parsed.ok) return jsonError(parsed.errors.join(" "), 400, { errors: parsed.errors });

  const ext = body.ext;
  const paths = uploadPaths(uploadId, ext);
  try {
    // The audit record was written by the server when the file was read;
    // read it back rather than trusting anything the browser sends.
    const dl = await supabaseAdmin().storage.from(BUCKET).download(paths.estimateExtraction);
    if (dl.error || !dl.data) return jsonError("Read this file with Claude before saving it.", 409);
    const audit = JSON.parse(await dl.data.text()) as { fields: unknown; fileName: string | null };

    // The original always stays attached, whatever the browser sent.
    const clean = parsed.value;
    if (!clean.attachments.some((a) => a.uploadId === uploadId.toLowerCase())) {
      clean.attachments = [{ uploadId: uploadId.toLowerCase(), ext, fileName: audit.fileName || `original.${ext}` }, ...clean.attachments].slice(0, 20);
    }
    const printed = typeof body.documentEstimateNumber === "string" ? body.documentEstimateNumber.trim().slice(0, 100) : "";
    const result = await createUploadedEstimate({ clean, documentEstimateNumber: printed, status, originalFilePath: paths.original, extractionJson: audit.fields });
    return NextResponse.json(result, { status: 201 });
  } catch (e) {
    if (e instanceof EstimateLockedError) return jsonError(e.message, 409);
    return serverError(e, "save old estimate");
  }
}
