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
    google:
      c.GOOGLE_CLIENT_ID && c.GOOGLE_CLIENT_SECRET && c.GOOGLE_REDIRECT_URI
        ? { clientId: c.GOOGLE_CLIENT_ID, clientSecret: c.GOOGLE_CLIENT_SECRET, redirectUri: c.GOOGLE_REDIRECT_URI }
        : null,
  };
}
