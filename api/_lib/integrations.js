// Server-only storage for third-party OAuth tokens (QuickBooks, Hover) in the
// integration_tokens table, which has RLS on and no policies — browsers can't
// read it, only the service role can.
import crypto from "crypto";
import { supabaseAdmin } from "./supabase.js";

export const APP_ORIGIN = (process.env.APP_ORIGIN || "https://freedom-exteriors.vercel.app").replace(/\/$/, "");

export async function getIntegration(provider) {
  const { data, error } = await supabaseAdmin().from("integration_tokens").select("data").eq("provider", provider).maybeSingle();
  if (error) throw new Error(`Couldn't read ${provider} connection`);
  return data?.data || null;
}

export async function setIntegration(provider, value) {
  const { error } = await supabaseAdmin()
    .from("integration_tokens")
    .upsert({ provider, data: value, updated_at: new Date().toISOString() }, { onConflict: "provider" });
  if (error) throw new Error(`Couldn't save ${provider} connection`);
}

export async function clearIntegration(provider) {
  await supabaseAdmin().from("integration_tokens").delete().eq("provider", provider);
}

// OAuth "state": a one-time random value tied to the login a staff member started,
// so a callback can't be forged or replayed to connect someone else's account.
export async function createOAuthState(provider, startedBy) {
  const state = crypto.randomBytes(24).toString("hex");
  await setIntegration(`${provider}_state`, { state, startedBy, expires_at: Date.now() + 10 * 60 * 1000 });
  return state;
}

export async function consumeOAuthState(provider, state) {
  const saved = await getIntegration(`${provider}_state`);
  await clearIntegration(`${provider}_state`);
  if (!saved?.state || typeof state !== "string" || saved.expires_at < Date.now()) return false;
  const a = Buffer.from(saved.state);
  const b = Buffer.from(state);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
