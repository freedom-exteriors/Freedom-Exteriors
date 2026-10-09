// Server-side helpers shared by the /api functions. Files under api/_lib are
// not deployed as endpoints (Vercel skips paths starting with "_").
import { createClient } from "@supabase/supabase-js";

let admin = null;

// Service-role client: bypasses RLS, so only use it after checking who's calling.
export function supabaseAdmin() {
  if (!admin) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_KEY;
    if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_KEY not configured");
    admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  }
  return admin;
}

// Verifies the caller's Supabase session (Authorization: Bearer <access token>)
// and that they're on the staff roster. Sends 401/403 and returns null if not.
export async function requireStaff(req, res, { role } = {}) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) { res.status(403).json({ error: "Sign in required" }); return null; }

  const db = supabaseAdmin();
  const { data: userData, error } = await db.auth.getUser(token);
  const email = userData?.user?.email?.toLowerCase();
  if (error || !email) { res.status(403).json({ error: "Session expired — sign in again" }); return null; }

  const { data: staff } = await db.from("staff").select("email,name,role,is_owner").eq("email", email).maybeSingle();
  if (!staff || (role && staff.role !== role)) { res.status(403).json({ error: "Not allowed" }); return null; }
  return staff;
}
