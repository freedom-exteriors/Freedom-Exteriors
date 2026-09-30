// Job photos: shrunk in the browser, stored in the private "job-photos" bucket at
// <jobId>/<uuid>.jpg, and shown through short-lived signed URLs. Older photos that
// still carry a base64 `url` keep working until they're moved (see movePhotosToStorage).
import { useEffect, useState } from "react";
import { supabase } from "./supabase";

export const PHOTO_BUCKET = "job-photos";
const MAX_EDGE = 1600;
const QUALITY = 0.8;

function uuid() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  const b = new Uint8Array(16);
  window.crypto.getRandomValues(b);
  return Array.from(b, x => x.toString(16).padStart(2, "0")).join("");
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Couldn't read that image"));
    img.src = src;
  });
}

/** Resize to at most 1600px on the long edge and re-encode as JPEG. */
export async function compressImage(fileOrDataUrl) {
  const isString = typeof fileOrDataUrl === "string";
  const src = isString ? fileOrDataUrl : URL.createObjectURL(fileOrDataUrl);
  try {
    const img = await loadImage(src);
    const scale = Math.min(1, MAX_EDGE / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff"; // transparent PNGs would otherwise turn black
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise(res => canvas.toBlob(res, "image/jpeg", QUALITY));
    if (!blob) throw new Error("Couldn't compress that image");
    return blob;
  } catch (e) {
    // A format the browser can't draw (e.g. HEIC outside Safari): upload as-is.
    if (!isString && fileOrDataUrl.type?.startsWith("image/")) return fileOrDataUrl;
    throw e;
  } finally {
    if (!isString) URL.revokeObjectURL(src);
  }
}

export function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

function extFor(type) {
  return { "image/png": "png", "image/webp": "webp", "image/gif": "gif", "image/heic": "heic", "image/heif": "heif" }[type] || "jpg";
}

/** Upload one photo for a job (staff). Returns the entry to store on job.photos. */
export async function uploadJobPhoto(jobId, blob, { id, name, cat, added } = {}) {
  const path = `${jobId}/${uuid()}.${extFor(blob.type)}`;
  const { error } = await supabase.storage.from(PHOTO_BUCKET).upload(path, blob, { contentType: blob.type || "image/jpeg", upsert: false });
  if (error) throw error;
  return { id: id ?? uuid(), path, name: name || "photo", cat: cat || "Damage", added: added || new Date().toLocaleDateString() };
}

const urlCache = new Map(); // path -> { url, exp }

/** Signed URLs for a list of photos, keyed by photo id. Base64 photos map to their own url. */
export function usePhotoUrls(photos) {
  const [urls, setUrls] = useState({});
  const key = (photos || []).map(p => p.path || p.id).join("|");
  useEffect(() => {
    let cancelled = false;
    const list = photos || [];
    const out = {};
    const need = [];
    const now = Date.now();
    for (const p of list) {
      if (!p.path) { if (p.url) out[p.id] = p.url; continue; }
      const c = urlCache.get(p.path);
      if (c && c.exp > now) out[p.id] = c.url; else need.push(p);
    }
    setUrls(out);
    if (!need.length) return;
    supabase.storage.from(PHOTO_BUCKET).createSignedUrls(need.map(p => p.path), 3600).then(({ data }) => {
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

/** Remove a job's stored photo files (used when an admin deletes the job). */
export async function deleteJobPhotoFiles(job) {
  const paths = (job?.photos || []).map(p => p.path).filter(Boolean);
  if (paths.length) await supabase.storage.from(PHOTO_BUCKET).remove(paths);
}

/**
 * One-time move of base64 photos into storage. Calls saveJob(jobId, photos) after
 * each job so progress survives a closed tab. Returns { moved, failed }.
 */
export async function movePhotosToStorage(jobs, saveJob, onProgress) {
  let moved = 0, failed = 0;
  const todo = jobs.filter(j => (j.photos || []).some(p => !p.path && typeof p.url === "string" && p.url.startsWith("data:")));
  for (let i = 0; i < todo.length; i++) {
    const job = todo[i];
    const photos = [];
    for (const p of job.photos) {
      if (p.path || !(typeof p.url === "string" && p.url.startsWith("data:"))) { photos.push(p); continue; }
      try {
        const blob = await compressImage(p.url);
        const entry = await uploadJobPhoto(job.id, blob, { id: p.id, name: p.name, cat: p.cat, added: p.added });
        photos.push(entry);
        moved++;
      } catch (e) {
        console.warn("Couldn't move photo", p.name, e);
        photos.push(p);
        failed++;
      }
    }
    await saveJob(job.id, photos);
    onProgress?.(i + 1, todo.length);
  }
  return { moved, failed, jobs: todo.length };
}
