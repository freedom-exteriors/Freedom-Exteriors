import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(3001),
  DATABASE_URL: z.string().min(1),
  /** Comma-separated origins allowed to make state-changing requests (CSRF check). */
  WEB_ORIGIN: z.string().default("http://localhost:5173"),
  /** Public base URL of the web app, used to build invite links. */
  PUBLIC_WEB_URL: z.string().optional(),
  CREDENTIALS_ENCRYPTION_KEY: z.string().optional(),
  GOOGLE_MAPS_API_KEY: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_AUTH_TOKEN: z.string().optional(),
  EXTRACTION_MODEL: z.string().default("claude-opus-5"),
  SUPABASE_URL: z.string().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
  SUPABASE_STORAGE_BUCKET: z.string().default("schedule-photos"),
  PHOTO_DIR: z.string().optional(),
  RESEND_API_KEY: z.string().optional(),
  NOTIFY_FROM_EMAIL: z.string().default("Home Base <alerts@example.com>"),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_REDIRECT_URI: z.string().optional(),
  AUTH_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(10),
});

export interface AppConfig {
  env: "development" | "test" | "production";
  port: number;
  databaseUrl: string;
  allowedOrigins: string[];
  publicWebUrl: string;
  cookieSecure: boolean;
  /** Per-IP limit on signup/login attempts per minute. */
  authRateLimitMax: number;
  /** base64 32-byte AES key for *Enc columns; null disables password-protected feeds. */
  credentialsKey: string | null;
  /** Google Maps Platform key (Geocoding + Routes); null disables address lookup and live traffic. */
  mapsApiKey: string | null;
  /** Vision model for photo extraction; null when no Anthropic credentials are configured. */
  extractionModel: string | null;
  /** Private Supabase Storage bucket for photos; null → local folder (`photoDir`). */
  supabaseStorage: { url: string; serviceRoleKey: string; bucket: string } | null;
  photoDir: string;
  /** Email delivery for notifications; null → in-app only. */
  email: { resendApiKey: string; from: string } | null;
  /** Google OAuth client; null disables "Connect Google Calendar". */
  google: { clientId: string; clientSecret: string; redirectUri: string } | null;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const c = schema.parse(env);
  const allowedOrigins = c.WEB_ORIGIN.split(",").map((o) => o.trim()).filter(Boolean);
  return {
    env: c.NODE_ENV,
    port: c.PORT,
    databaseUrl: c.DATABASE_URL,
    allowedOrigins,
    publicWebUrl: (c.PUBLIC_WEB_URL || allowedOrigins[0]!).replace(/\/$/, ""),
    cookieSecure: c.NODE_ENV === "production",
    authRateLimitMax: c.AUTH_RATE_LIMIT_PER_MINUTE,
    credentialsKey: c.CREDENTIALS_ENCRYPTION_KEY || null,
    mapsApiKey: c.GOOGLE_MAPS_API_KEY || null,
    extractionModel: c.ANTHROPIC_API_KEY || c.ANTHROPIC_AUTH_TOKEN ? c.EXTRACTION_MODEL : null,
    supabaseStorage:
      c.SUPABASE_URL && c.SUPABASE_SERVICE_ROLE_KEY
        ? { url: c.SUPABASE_URL, serviceRoleKey: c.SUPABASE_SERVICE_ROLE_KEY, bucket: c.SUPABASE_STORAGE_BUCKET }
        : null,
    email: c.RESEND_API_KEY ? { resendApiKey: c.RESEND_API_KEY, from: c.NOTIFY_FROM_EMAIL } : null,
    photoDir: c.PHOTO_DIR || new URL("../.data/photos", import.meta.url).pathname,
    google:
      c.GOOGLE_CLIENT_ID && c.GOOGLE_CLIENT_SECRET && c.GOOGLE_REDIRECT_URI
        ? { clientId: c.GOOGLE_CLIENT_ID, clientSecret: c.GOOGLE_CLIENT_SECRET, redirectUri: c.GOOGLE_REDIRECT_URI }
        : null,
  };
}
