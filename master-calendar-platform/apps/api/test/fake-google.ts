import { GoogleAuthRevokedError, type GoogleApi, type GoogleCalendarEntry, type GoogleEvent, type GoogleTokens } from "../src/integrations/google-api.js";

const jwt = (claims: object) => `x.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.sig`;

/** YYYY-MM-DD / ISO strings n days from now, so fixtures never go stale. */
export const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
export const at = (n: number, hhmmZ: string) => `${day(n)}T${hhmmZ}:00Z`;

export class FakeGoogle implements GoogleApi {
  scope = "openid email https://www.googleapis.com/auth/calendar.readonly";
  account = { sub: "google-sub-123", email: "Alex.Rivera@gmail.com" };
  calendars: GoogleCalendarEntry[] = [
    { id: "alex@gmail.com", name: "Alex", primary: true, color: "#4285F4", accessRole: "owner", timeZone: "America/Chicago" },
    { id: "family123@group.calendar.google.com", name: "Rivera Family", primary: false, color: "#0B8043", accessRole: "writer", timeZone: "America/Chicago" },
  ];
  events: Record<string, GoogleEvent[]> = {
    "family123@group.calendar.google.com": [
      { id: "dentist", summary: "Dentist — Leo", location: "Maple Dental", start: { dateTime: at(3, "15:00") }, end: { dateTime: at(3, "16:00") } },
      { id: "noschool", summary: "No school", start: { date: day(5) }, end: { date: day(6) } },
      { id: "piano_1", recurringEventId: "piano", summary: "Piano", start: { dateTime: at(2, "22:00") }, end: { dateTime: at(2, "22:45") }, originalStartTime: { dateTime: at(2, "22:00") } },
      // One instance of the series moved a day later — same originalStartTime identity.
      { id: "piano_2", recurringEventId: "piano", summary: "Piano (moved)", start: { dateTime: at(10, "23:00") }, end: { dateTime: at(10, "23:45") }, originalStartTime: { dateTime: at(9, "22:00") } },
      { id: "gone", status: "cancelled", summary: "Cancelled thing", start: { dateTime: at(4, "10:00") }, end: { dateTime: at(4, "11:00") } },
      { id: "wfh", eventType: "workingLocation", summary: "Home", start: { date: day(1) }, end: { date: day(2) } },
    ],
  };
  exchanges: string[] = []; // code verifiers seen
  refreshCalls = 0;
  refreshError: Error | null = null;
  revoked: string[] = [];
  tokensSeen: string[] = [];
  private n = 1;

  authUrl({ state, codeChallenge }: { state: string; codeChallenge: string }) {
    return `https://accounts.google.example/auth?state=${state}&code_challenge=${codeChallenge}&code_challenge_method=S256`;
  }
  async exchangeCode(code: string, verifier: string): Promise<GoogleTokens> {
    if (code !== "good-code") throw new Error("bad code");
    this.exchanges.push(verifier);
    return { accessToken: `access-${this.n++}`, refreshToken: "refresh-1", expiresAt: new Date(Date.now() + 3600_000), scope: this.scope, idToken: jwt(this.account) };
  }
  async refresh(): Promise<GoogleTokens> {
    this.refreshCalls++;
    if (this.refreshError) throw this.refreshError;
    return { accessToken: `access-${this.n++}`, refreshToken: null, expiresAt: new Date(Date.now() + 3600_000), scope: this.scope, idToken: null };
  }
  async listCalendars(token: string) {
    this.tokensSeen.push(token);
    return this.calendars;
  }
  async listEvents(token: string, calendarId: string) {
    this.tokensSeen.push(token);
    return this.events[calendarId] ?? [];
  }
  async revoke(token: string) {
    this.revoked.push(token);
  }
  revokeAccess() {
    this.refreshError = new GoogleAuthRevokedError("revoked");
  }
}
