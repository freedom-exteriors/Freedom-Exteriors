// Homeowner photos from the portal. The portal has no login, so the portal token
// is the key: POST stores one (already-shrunk) photo for that token's job; GET
// returns short-lived links to the photos the homeowner uploaded.
import crypto from "crypto";
import { supabaseAdmin } from "./_lib/supabase.js";

const BUCKET = "job-photos";
const MAX_BYTES = 3 * 1024 * 1024;
const TYPES = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

async function jobIdFor(db, token) {
  if (typeof token !== "string" || token.length < 8 || token.length > 200) return null;
  const { data } = await db.rpc("portal_job_id", { p_token: token });
  return data || null;
}

export default async function handler(req, res) {
  let db;
  try { db = supabaseAdmin(); } catch (e) { return res.status(500).json({ error: "Photo uploads aren't set up yet" }); }

  if (req.method === "GET") {
    const token = req.query.token;
    const jobId = await jobIdFor(db, token);
    if (!jobId) return res.status(404).json({ error: "Portal link not found" });
    const { data: list } = await db.rpc("portal_homeowner_photos", { p_token: token });
    const mine = Array.isArray(list) ? list : [];
    const paths = mine.map(p => p.path).filter(p => typeof p === "string" && p.startsWith(`${jobId}/`));
    const urls = {};
    if (paths.length) {
      const { data } = await db.storage.from(BUCKET).createSignedUrls(paths, 3600);
      (data || []).forEach((d, i) => { if (d?.signedUrl) urls[paths[i]] = d.signedUrl; });
    }
    return res.status(200).json({
      photos: mine.map(p => ({ id: p.id, name: p.name, added: p.added, url: p.path ? urls[p.path] || null : p.url || null })),
    });
  }

  if (req.method === "POST") {
    const { token, name, dataUrl } = req.body || {};
    const jobId = await jobIdFor(db, token);
    if (!jobId) return res.status(404).json({ error: "Portal link not found" });
    const m = typeof dataUrl === "string" && dataUrl.match(/^data:(image\/(?:jpeg|png|webp));base64,(.+)$/);
    if (!m) return res.status(400).json({ error: "That file isn't a photo we can use — try a JPG or PNG" });
    const bytes = Buffer.from(m[2], "base64");
    if (!bytes.length || bytes.length > MAX_BYTES) return res.status(400).json({ error: "That photo is too large" });

    const id = crypto.randomUUID();
    const path = `${jobId}/${id}.${TYPES[m[1]]}`;
    const { error: upErr } = await db.storage.from(BUCKET).upload(path, bytes, { contentType: m[1], upsert: false });
    if (upErr) return res.status(500).json({ error: "Upload failed — try again" });

    const { error } = await db.rpc("portal_record_photo", {
      p_token: token,
      p_photo: { id, path, name: String(name || "photo").slice(0, 200), added: new Date().toLocaleDateString("en-US", { timeZone: "America/Chicago" }) },
    });
    if (error) {
      await db.storage.from(BUCKET).remove([path]);
      return res.status(400).json({ error: /limit/i.test(error.message) ? "Photo limit reached for this project — text your rep to send more" : "Upload failed — try again" });
    }
    return res.status(200).json({ ok: true });
  }

  res.setHeader("Allow", "GET, POST");
  return res.status(405).json({ error: "Method not allowed" });
}
