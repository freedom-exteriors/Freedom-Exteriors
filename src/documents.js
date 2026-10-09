// Signed documents: paper contracts/agreements that were signed by hand
// (not through the in-app e-sign flow) and then photographed or scanned.
// Stored as-is (no compression — these need to stay legible/legal-grade) in
// the private "job-documents" bucket at <jobId>/<uuid>.<ext>, shown through
// short-lived signed URLs. Mirrors photos.js's bucket/signed-URL pattern.
import { useEffect, useState } from "react";
import { supabase } from "./supabase";

export const DOCUMENT_BUCKET = "job-documents";

function uuid() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  const b = new Uint8Array(16);
  window.crypto.getRandomValues(b);
  return Array.from(b, x => x.toString(16).padStart(2, "0")).join("");
}

function extFor(file) {
  const fromName = (file.name || "").split(".").pop();
  if (fromName && fromName.length <= 5 && /^[a-zA-Z0-9]+$/.test(fromName)) return fromName.toLowerCase();
  return { "application/pdf": "pdf", "image/png": "png", "image/webp": "webp", "image/heic": "heic", "image/heif": "heif" }[file.type] || "jpg";
}

/** Upload one signed document for a job (staff). Returns the entry to store on job.signedDocuments. */
export async function uploadJobDocument(jobId, file, { label } = {}) {
  const path = `${jobId}/${uuid()}.${extFor(file)}`;
  const { error } = await supabase.storage.from(DOCUMENT_BUCKET).upload(path, file, { contentType: file.type || "application/octet-stream", upsert: false });
  if (error) throw error;
  return {
    id: uuid(),
    path,
    name: file.name || "Signed document",
    label: label || "Signed document",
    isImage: (file.type || "").startsWith("image/"),
    added: new Date().toISOString(),
  };
}

const urlCache = new Map(); // path -> { url, exp }

/** Signed URLs for a list of documents, keyed by document id. */
export function useDocumentUrls(documents) {
  const [urls, setUrls] = useState({});
  const key = (documents || []).map(d => d.path).join("|");
  useEffect(() => {
    let cancelled = false;
    const list = documents || [];
    const out = {};
    const need = [];
    const now = Date.now();
    for (const d of list) {
      if (!d.path) continue;
      const c = urlCache.get(d.path);
      if (c && c.exp > now) out[d.id] = c.url; else need.push(d);
    }
    setUrls(out);
    if (!need.length) return;
    supabase.storage.from(DOCUMENT_BUCKET).createSignedUrls(need.map(d => d.path), 3600).then(({ data }) => {
      if (cancelled || !data) return;
      const add = {};
      data.forEach((d, i) => {
        if (!d?.signedUrl) return;
        urlCache.set(need[i].path, { url: d.signedUrl, exp: Date.now() + 50 * 60 * 1000 });
        add[need[i].id] = d.signedUrl;
      });
      setUrls(prev => ({ ...prev, ...add }));
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return urls;
}

/** Remove a job's stored document files (used when an admin deletes the job, or removes one document). */
export async function deleteJobDocumentFiles(paths) {
  if (paths.length) await supabase.storage.from(DOCUMENT_BUCKET).remove(paths);
}
