import { NextResponse, type NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { BUCKET, supabaseAdmin } from "@/lib/supabaseAdmin";
import { cleanAttachments } from "@/lib/estimate";
import { EXTRACTION_MODEL, ExtractionError } from "@/lib/extract";
import { listPriceBook } from "@/lib/estimates.server";
import { MAX_SUGGEST_FILES, suggestEstimate, type SuggestFile } from "@/lib/suggest.server";
import { MAX_UPLOAD_BYTES, sniffType, UPLOAD_TYPES, uploadPaths } from "@/lib/uploads.server";
import { jsonError, readJson, serverError } from "@/lib/http";

export const maxDuration = 300;

// Reads the files attached to an estimate with Claude and returns suggested
// lines for the builder. Saves the raw response for auditing; nothing is
// written to the estimates table here.
// Body: { files: [{ uploadId, ext, fileName }], note?: string }
export async function POST(req: NextRequest) {
  const body = (await readJson(req)) as { files?: unknown; note?: unknown } | null;
  const files = cleanAttachments(body?.files);
  if (files.length === 0) return jsonError("Add at least one photo or file first.");
  if (files.length > MAX_SUGGEST_FILES) return jsonError(`Claude can read up to ${MAX_SUGGEST_FILES} files at a time. Remove some and try again.`);
  const note = typeof body?.note === "string" ? body.note.trim().slice(0, 4000) : "";
  const db = supabaseAdmin();

  try {
    const loaded: SuggestFile[] = [];
    for (const f of files) {
      const dl = await db.storage.from(BUCKET).download(uploadPaths(f.uploadId, f.ext).original);
      if (dl.error || !dl.data) return jsonError(`"${f.fileName}" wasn't found. Remove it and upload it again.`, 404);
      const buf = Buffer.from(await dl.data.arrayBuffer());
      if (buf.length > MAX_UPLOAD_BYTES) return jsonError(`"${f.fileName}" is larger than 20 MB.`);
      if (sniffType(buf) !== f.ext) return jsonError(`"${f.fileName}" isn't a real PDF, PNG, JPG or Word .docx file (its contents don't match its type).`);
      loaded.push({ buf, mime: UPLOAD_TYPES[f.ext], fileName: f.fileName });
    }

    const priceBook = await listPriceBook(false);
    const { suggestion, raw } = await suggestEstimate(loaded, priceBook, note);

    const audit = { files, note, model: EXTRACTION_MODEL, suggestedAt: new Date().toISOString(), suggestion, raw };
    const up = await db.storage
      .from(BUCKET)
      .upload(`suggestions/${randomUUID()}.json`, Buffer.from(JSON.stringify(audit)), { contentType: "application/json", upsert: false });
    if (up.error) console.error("[suggest] saving audit record failed:", up.error.message);

    return NextResponse.json({ suggestion });
  } catch (e) {
    if (e instanceof ExtractionError) return jsonError(e.message, 422);
    return serverError(e, "suggest estimate");
  }
}
