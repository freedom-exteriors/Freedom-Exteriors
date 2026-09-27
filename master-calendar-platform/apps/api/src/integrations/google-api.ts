// Thin Google OAuth + Calendar v3 client. Behind an interface so tests (and anything
// offline) can swap in a fake. Read-only: we never write to anyone's Google Calendar.

export const GOOGLE_SCOPES = ["openid", "email", "https://www.googleapis.com/auth/calendar.readonly"];
export const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.readonly";

export interface GoogleTokens {
  accessToken: string;
  /** Only on first consent (we always request prompt=consent, so we get one). */
  refreshToken: string | null;
  expiresAt: Date;
  scope: string;
  idToken: string | null;
}

export interface GoogleCalendarEntry {
  id: string;
  name: string;
  primary: boolean;
  color: string | null;
  accessRole: string;
  timeZone: string | null;
}

export interface GoogleEventTime {
  date?: string; // all-day: YYYY-MM-DD (end date is exclusive)
  dateTime?: string; // RFC 3339 with offset
  timeZone?: string;
}

export interface GoogleEvent {
  id: string;
  status?: string;
  summary?: string;
  description?: string;
  location?: string;
  htmlLink?: string;
  eventType?: string;
  start: GoogleEventTime;
  end: GoogleEventTime;
  recurringEventId?: string;
  originalStartTime?: GoogleEventTime;
}

/** The person revoked access, or the refresh token expired: they must reconnect. */
export class GoogleAuthRevokedError extends Error {}
export class GoogleApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export interface GoogleApi {
  authUrl(p: { state: string; codeChallenge: string }): string;
  exchangeCode(code: string, codeVerifier: string): Promise<GoogleTokens>;
  refresh(refreshToken: string): Promise<GoogleTokens>;
  listCalendars(accessToken: string): Promise<GoogleCalendarEntry[]>;
  listEvents(accessToken: string, calendarId: string, range: { timeMin: Date; timeMax: Date }): Promise<GoogleEvent[]>;
  revoke(token: string): Promise<void>;
}

/** Claims from the id_token. It came straight from Google's token endpoint over TLS, so per
 *  OIDC Core §3.1.3.7 its signature needn't be re-verified here. */
export function decodeIdToken(idToken: string): { sub: string; email: string } {
  const payload = JSON.parse(Buffer.from(idToken.split(".")[1] ?? "", "base64url").toString("utf8"));
  if (!payload.sub || !payload.email) throw new Error("id_token missing sub/email");
  return { sub: String(payload.sub), email: String(payload.email).toLowerCase() };
}

type Fetch = typeof fetch;

export class HttpGoogleApi implements GoogleApi {
  constructor(
    private readonly cfg: { clientId: string; clientSecret: string; redirectUri: string },
    private readonly fetchImpl: Fetch = fetch,
  ) {}

  authUrl({ state, codeChallenge }: { state: string; codeChallenge: string }): string {
    const u = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    u.search = new URLSearchParams({
      client_id: this.cfg.clientId,
      redirect_uri: this.cfg.redirectUri,
      response_type: "code",
      scope: GOOGLE_SCOPES.join(" "),
      state,
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
      access_type: "offline", // → refresh token, so syncs work while nobody's logged in
      prompt: "consent", // → always a refresh token, even on reconnect
      include_granted_scopes: "true",
    }).toString();
    return u.toString();
  }

  async exchangeCode(code: string, codeVerifier: string): Promise<GoogleTokens> {
    return this.token({
      grant_type: "authorization_code",
      code,
      code_verifier: codeVerifier,
      redirect_uri: this.cfg.redirectUri,
    });
  }

  async refresh(refreshToken: string): Promise<GoogleTokens> {
    return this.token({ grant_type: "refresh_token", refresh_token: refreshToken });
  }

  private async token(params: Record<string, string>): Promise<GoogleTokens> {
    const res = await this.fetchImpl("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ ...params, client_id: this.cfg.clientId, client_secret: this.cfg.clientSecret }),
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      if (data.error === "invalid_grant") throw new GoogleAuthRevokedError("Google access was revoked or expired");
      throw new GoogleApiError(res.status, `Google token endpoint: ${String(data.error ?? res.status)}`);
    }
    return {
      accessToken: String(data.access_token),
      refreshToken: typeof data.refresh_token === "string" ? data.refresh_token : null,
      expiresAt: new Date(Date.now() + Number(data.expires_in ?? 3600) * 1000),
      scope: String(data.scope ?? ""),
      idToken: typeof data.id_token === "string" ? data.id_token : null,
    };
  }

  async listCalendars(accessToken: string): Promise<GoogleCalendarEntry[]> {
    const items = await this.paged<Record<string, unknown>>(accessToken, "https://www.googleapis.com/calendar/v3/users/me/calendarList", {
      minAccessRole: "reader",
    });
    return items.map((c) => ({
      id: String(c.id),
      name: String(c.summaryOverride ?? c.summary ?? c.id),
      primary: c.primary === true,
      color: typeof c.backgroundColor === "string" ? c.backgroundColor : null,
      accessRole: String(c.accessRole),
      timeZone: typeof c.timeZone === "string" ? c.timeZone : null,
    }));
  }

  async listEvents(accessToken: string, calendarId: string, range: { timeMin: Date; timeMax: Date }): Promise<GoogleEvent[]> {
    return this.paged<GoogleEvent>(accessToken, `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`, {
      singleEvents: "true", // Google expands recurring series into instances for us
      timeMin: range.timeMin.toISOString(),
      timeMax: range.timeMax.toISOString(),
      maxResults: "2500",
    });
  }

  async revoke(token: string): Promise<void> {
    await this.fetchImpl(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, { method: "POST" }).catch(() => {});
  }

  private async paged<T>(accessToken: string, url: string, params: Record<string, string>): Promise<T[]> {
    const out: T[] = [];
    let pageToken: string | undefined;
    for (let page = 0; page < 50; page++) {
      const u = new URL(url);
      u.search = new URLSearchParams({ ...params, ...(pageToken ? { pageToken } : {}) }).toString();
      const res = await this.fetchImpl(u, { headers: { Authorization: `Bearer ${accessToken}` } });
      if (!res.ok) throw new GoogleApiError(res.status, `Google Calendar API ${res.status}`);
      const data = (await res.json()) as { items?: T[]; nextPageToken?: string };
      out.push(...(data.items ?? []));
      pageToken = data.nextPageToken;
      if (!pageToken) return out;
    }
    return out;
  }
}
