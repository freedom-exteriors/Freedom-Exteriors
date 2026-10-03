import { NextResponse, type NextRequest } from "next/server";
import { BUCKET, supabaseAdmin } from "@/lib/supabaseAdmin";
import { extractInvoice, ExtractionError, EXTRACTION_MODEL } from "@/lib/extract";
import { draftFromExtraction } from "@/lib/review";
import { isUploadExt, MAX_UPLOAD_BYTES, sniffType, UPLOAD_TYPES, uploadPaths } from "@/lib/uploads.server";
import { isUuid, jsonError, readJson, serverError } from "@/lib/http";

export const maxDuration = 300;

// Step 2: read the stored original with Claude. Saves the raw response to
// storage for auditing and returns a DRAFT for the review screen. Nothing
// is written to the invoices table here.
export async function POST(req: NextRequest, ctx: RouteContext<"/api/uploads/[uploadId]/extract">) {
  const { uploadId } = await ctx.params;
  const body = (await readJson(req)) as { ext?: unknown; fileName?: unknown } | null;
  if (!isUuid(uploadId) || !isUploadExt(body?.ext)) return jsonError("Not found", 404);
  const ext = body.ext;
  const paths = uploadPaths(uploadId, ext);
  const db = supabaseAdmin();

  try {
    const dl = await db.storage.from(BUCKET).download(paths.original);
    if (dl.error || !dl.data) return jsonError("The uploaded file wasn't found. Try uploading it again.", 404);
    const buf = Buffer.from(await dl.data.arrayBuffer());
    if (buf.length > MAX_UPLOAD_BYTES) return jsonError("The file is larger than 20 MB.");
    const actual = sniffType(buf);
    if (actual !== ext) {
      return jsonError("This file isn't a real PDF, PNG, JPG or Word .docx file (its contents don't match its type).");
    }

    const { fields, raw, text } = await extractInvoice(buf, UPLOAD_TYPES[ext]);
    const audit = {
      uploadId,
      fileName: typeof body.fileName === "string" ? body.fileName.slice(0, 200) : null,
      model: EXTRACTION_MODEL,
      extractedAt: new Date().toISOString(),
      fields,
      raw,
      documentText: text, // Word files: exactly what Claude was given
    };
    const up = await db.storage
      .from(BUCKET)
      .upload(paths.extraction, Buffer.from(JSON.stringify(audit)), { contentType: "application/json", upsert: true });
    if (up.error) throw new Error(`Saving the extraction record failed: ${up.error.message}`);

    // Browsers can't display a .docx, so the review screen shows its text.
    return NextResponse.json({ draft: draftFromExtraction(fields), previewText: text });
  } catch (e) {
    if (e instanceof ExtractionError) return jsonError(e.message, 422);
    return serverError(e, "extract");
  }
}
