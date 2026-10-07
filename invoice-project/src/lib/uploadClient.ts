// Browser side of an upload: HEIC → JPG, then straight to the private bucket
// through a one-time signed URL. Used by the invoice upload page and by the
// estimate builder's "Start from photos or files" box.
import { api } from "./clientApi";

export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
export type UploadExt = "pdf" | "png" | "jpg" | "docx";
export const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
export const UPLOAD_MIME: Record<UploadExt, string> = { pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", docx: DOCX_MIME };
export const UPLOAD_ACCEPT = `.pdf,.docx,.png,.jpg,.jpeg,.heic,.heif,application/pdf,${DOCX_MIME},image/png,image/jpeg,image/heic,image/heif`;

export function extOf(file: File): UploadExt | "heic" | "doc" | null {
  const name = file.name.toLowerCase();
  if (file.type === DOCX_MIME || name.endsWith(".docx")) return "docx";
  if (name.endsWith(".doc")) return "doc";
  if (file.type === "application/pdf" || name.endsWith(".pdf")) return "pdf";
  if (file.type === "image/png" || name.endsWith(".png")) return "png";
  if (file.type === "image/jpeg" || /\.jpe?g$/.test(name)) return "jpg";
  if (/image\/hei[cf]/.test(file.type) || /\.hei[cf]$/.test(name)) return "heic";
  return null;
}

/** iPhone photos (HEIC) are converted to JPG in the browser before upload. */
async function heicToJpeg(file: File): Promise<File> {
  const heic2any = (await import("heic2any")).default;
  const out = await heic2any({ blob: file, toType: "image/jpeg", quality: 0.9 });
  const blob = Array.isArray(out) ? out[0] : out;
  return new File([blob], file.name.replace(/\.hei[cf]$/i, "") + ".jpg", { type: "image/jpeg" });
}

/**
 * Checks, converts and uploads one file. Throws an Error with a plain-English
 * message if the file can't be used. `onStep` reports progress text.
 */
export async function uploadFile(original: File, onStep?: (message: string) => void): Promise<{ uploadId: string; ext: UploadExt; file: File }> {
  const kind = extOf(original);
  if (kind === null) throw new Error(`"${original.name}" isn't a PDF, Word (.docx), PNG, JPG or HEIC file. Save or export it as a PDF and try again.`);
  if (kind === "doc") throw new Error(`"${original.name}" is an old-style Word file (.doc). Open it in Word, choose File → Save As → Word Document (.docx) or PDF, and upload that.`);
  let file = original;
  let ext: UploadExt;
  if (kind === "heic") {
    onStep?.(`Converting iPhone photo ${original.name} to JPG…`);
    try {
      file = await heicToJpeg(original);
    } catch {
      throw new Error(`"${original.name}" couldn't be converted. On your iPhone, open it and use Share → Save as JPEG (or take a screenshot), then upload that.`);
    }
    ext = "jpg";
  } else {
    ext = kind;
  }
  if (file.size > MAX_UPLOAD_BYTES) throw new Error(`"${original.name}" is ${(file.size / 1048576).toFixed(1)} MB. The limit is 20 MB.`);
  if (file.size === 0) throw new Error(`"${original.name}" is empty.`);

  onStep?.(`Uploading ${file.name}…`);
  const { uploadId, signedUrl } = await api<{ uploadId: string; signedUrl: string }>("/api/uploads", {
    method: "POST",
    json: { ext, size: file.size, fileName: file.name },
  });
  const put = await fetch(signedUrl, { method: "PUT", headers: { "Content-Type": UPLOAD_MIME[ext], "x-upsert": "false" }, body: file });
  if (!put.ok) throw new Error(`Uploading "${file.name}" failed (${put.status}). Try again.`);
  return { uploadId, ext, file };
}

/**
 * Opens a stored upload in a new tab. The tab is opened right away (inside
 * the click) so pop-up blockers allow it, then pointed at the signed link.
 */
export async function viewUpload(uploadId: string, ext: UploadExt) {
  const tab = window.open("", "_blank");
  try {
    const { url } = await api<{ url: string }>(`/api/uploads/${uploadId}/view?ext=${ext}`);
    if (tab) tab.location.href = url;
    else window.location.href = url;
  } catch (e) {
    tab?.close();
    throw e;
  }
}
