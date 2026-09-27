import { useState, type FormEvent } from "react";
import { NavLink, useParams, useSearchParams } from "react-router-dom";
import { api } from "../lib/api";
import { useAction, useLoad } from "../lib/hooks";
import { useWorkspace } from "../components/WorkspaceLayout";
import { fmt } from "../lib/dates";

const TABS = [["calendars", "Calendars"], ["people", "People & places"], ["members", "Members"], ["wall", "Wall screen"], ["notifications", "Notifications"]] as const;

export function SettingsPage() {
  const { tab = "calendars" } = useParams();
  return (
    <section>
      <nav className="subtabs">
        {TABS.map(([k, label]) => <NavLink key={k} to={`../${k}`} relative="path" className={({ isActive }) => (isActive ? "on" : "")}>{label}</NavLink>)}
      </nav>
      {tab === "calendars" && <Calendars />}
      {tab === "people" && <People />}
      {tab === "members" && <Members />}
      {tab === "wall" && <WallScreens />}
      {tab === "notifications" && <Notifications />}
    </section>
  );
}

interface Source { id: string; name: string | null; type: string; feed: string | null; googleAccount: { email: string; status: string } | null; lastSyncedAt: string | null; lastSyncError: string | null; eventCount: number; defaultParticipantId: string | null }
interface Connection { id: string; email: string; status: string; calendarCount: number; mine: boolean }
interface GoogleCal { id: string; name: string; primary: boolean; color: string | null; sourceId: string | null }

function Calendars() {
  const { ws, base, can } = useWorkspace();
  const [params, setParams] = useSearchParams();
  const sources = useLoad(() => api.get<Source[]>(`${base}/calendar-sources`), [base]);
  const conns = useLoad(() => (can.edit ? api.get<Connection[]>(`${base}/integrations/google`) : Promise.resolve([])), [base]);
  const [feed, setFeed] = useState({ feedUrl: "", name: "", defaultParticipantId: "" });
  const [picking, setPicking] = useState<string | null>(params.get("connectionId"));
  const act = useAction();
  const people = ws.participants.filter((p) => !p.linkedWorkspaceId);

  const addFeed = async (e: FormEvent) => {
    e.preventDefault();
    if (await act.run(() => api.post(`${base}/calendar-sources`, { feedUrl: feed.feedUrl, name: feed.name || undefined, defaultParticipantId: feed.defaultParticipantId || null }))) {
      setFeed({ feedUrl: "", name: "", defaultParticipantId: "" });
      void sources.reload();
    }
  };
  const connectGoogle = () => act.run(async () => { window.location.href = (await api.post<{ url: string }>(`${base}/integrations/google/start`)).url; });
  const sync = async (id: string) => { await act.run(() => api.post(`${base}/calendar-sources/${id}/sync`)); void sources.reload(); };
  const remove = async (s: Source) => {
    if (!confirm(`Remove “${s.name}” and its ${s.eventCount} events?`)) return;
    await act.run(() => api.del(`${base}/calendar-sources/${s.id}`));
    void sources.reload();
  };
  const setDefault = async (s: Source, participantId: string) => {
    await act.run(() => api.patch(`${base}/calendar-sources/${s.id}`, { defaultParticipantId: participantId || null, applyToExisting: true }));
    void sources.reload();
  };
  const googleMsg = params.get("google");

  return (
    <div className="stack">
      {params.get("welcome") && <div className="card note">👋 Welcome! Start by connecting a calendar — a team or school "subscribe" link, or your Google Calendar.</div>}
      {googleMsg === "connected" && <div className="card note ok">Google connected. Pick which calendars to bring in below.</div>}
      {googleMsg === "error" && <div className="card note"><span className="error">Google wasn't connected ({params.get("reason")?.replaceAll("_", " ")}).</span></div>}

      <h2>Connected calendars</h2>
      <ul className="items">
        {sources.data?.filter((s) => s.type !== "photo_extraction" || s.eventCount > 0).map((s) => (
          <li key={s.id} className="item">
            <div className="grow">
              <b>{s.name ?? s.type}</b> <span className="muted small">{s.type === "google" ? `Google · ${s.googleAccount?.email}` : s.type === "ics_feed" ? s.feed ?? "sample data" : "photo imports"} · {s.eventCount} events</span>
              <div className="muted small">{s.lastSyncError ? <span className="error">{s.lastSyncError}</span> : s.lastSyncedAt ? `Updated ${fmt(s.lastSyncedAt, ws.timeZone, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}` : ""}</div>
            </div>
            {can.edit && s.type !== "photo_extraction" && (
              <>
                <select aria-label="Whose events" value={s.defaultParticipantId ?? ""} onChange={(e) => setDefault(s, e.target.value)}>
                  <option value="">Assign each event</option>
                  {people.map((p) => <option key={p.id} value={p.id}>All {p.name}'s</option>)}
                </select>
                {(s.feed || s.googleAccount) && <button onClick={() => sync(s.id)}>Refresh</button>}
                <button className="ghost" onClick={() => remove(s)}>Remove</button>
              </>
            )}
          </li>
        ))}
      </ul>

      {can.edit && (
        <>
          <form className="card stack" onSubmit={addFeed}>
            <b>Add a calendar link</b>
            <p className="muted small">SportsEngine, TeamSnap, ParentSquare, school district, Outlook/Apple "publish" links — look for Subscribe, iCal, or .ics.</p>
            <input required placeholder="webcal://… or https://….ics" value={feed.feedUrl} onChange={(e) => setFeed({ ...feed, feedUrl: e.target.value })} aria-label="Calendar link" />
            <div className="row wrap">
              <input placeholder="Name (e.g. U12 Soccer)" value={feed.name} onChange={(e) => setFeed({ ...feed, name: e.target.value })} aria-label="Name" />
              <select value={feed.defaultParticipantId} onChange={(e) => setFeed({ ...feed, defaultParticipantId: e.target.value })} aria-label="Whose">
                <option value="">Whose events?</option>
                {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <button className="primary" disabled={act.busy}>{act.busy ? "Checking…" : "Add"}</button>
            </div>
          </form>

          <div className="card stack">
            <div className="row between"><b>Google Calendar</b><button onClick={connectGoogle}>Connect Google</button></div>
            {conns.data?.map((c) => (
              <div key={c.id} className="row between">
                <span>{c.email} · {c.calendarCount} calendars {c.status === "needs_reauth" && <span className="error">— reconnect needed</span>}</span>
                {c.mine && <button className="ghost" onClick={() => setPicking(c.id)}>Choose calendars</button>}
              </div>
            ))}
            {picking && <GooglePicker connectionId={picking} onDone={() => { setPicking(null); setParams({}); void sources.reload(); void conns.reload(); }} />}
          </div>
        </>
      )}
      {act.error && <p className="error">{act.error}</p>}
    </div>
  );
}

function GooglePicker({ connectionId, onDone }: { connectionId: string; onDone: () => void }) {
  const { base } = useWorkspace();
  const cals = useLoad(() => api.get<GoogleCal[]>(`${base}/integrations/google/${connectionId}/calendars`), [connectionId]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const act = useAction();
  const add = async () => {
    if (await act.run(() => api.post(`${base}/integrations/google/${connectionId}/calendars`, { calendars: [...picked].map((calendarId) => ({ calendarId })) }))) onDone();
  };
  if (cals.error) return <p className="error">{cals.error}</p>;
  return (
    <div className="stack">
      {cals.data?.map((c) => (
        <label key={c.id} className="row">
          <input type="checkbox" disabled={!!c.sourceId} checked={!!c.sourceId || picked.has(c.id)} onChange={() => setPicked((s) => { const n = new Set(s); n.has(c.id) ? n.delete(c.id) : n.add(c.id); return n; })} />
          <i className="dot" style={{ background: c.color ?? "#888" }} /> {c.name} {c.primary && <span className="muted small">(main)</span>} {c.sourceId && <span className="muted small">added</span>}
        </label>
      ))}
      {act.error && <p className="error">{act.error}</p>}
      <button className="primary" disabled={!picked.size || act.busy} onClick={add}>Bring in {picked.size || ""} calendar{picked.size === 1 ? "" : "s"}</button>
    </div>
  );
}

interface Participant { id: string; name: string; color: string; canDrive: boolean; homePlace: { id: string; name: string } | null; hasLogin: boolean; linkedWorkspaceId: string | null; availability: { dayOfWeek: number; startMinute: number; endMinute: number }[] }
interface Place { id: string; name: string; kind: string; address: string | null }
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const hm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

function People() {
  const { base, can, reloadWorkspace } = useWorkspace();
  const people = useLoad(() => api.get<Participant[]>(`${base}/participants`), [base]);
  const places = useLoad(() => api.get<Place[]>(`${base}/places`), [base]);
  const [name, setName] = useState("");
  const [place, setPlace] = useState({ name: "", address: "", kind: "other" });
  const act = useAction();
  const reload = () => { void people.reload(); void reloadWorkspace(); };

  const addPerson = async (e: FormEvent) => {
    e.preventDefault();
    if (await act.run(() => api.post(`${base}/participants`, { name }))) { setName(""); reload(); }
  };
  const patch = async (p: Participant, body: object) => { await act.run(() => api.patch(`${base}/participants/${p.id}`, body)); reload(); };
  const setHours = async (p: Participant) => {
    const current = p.availability.length ? `${hm(p.availability[0]!.startMinute)}-${hm(p.availability[0]!.endMinute)}` : "17:30-21:00";
    const v = prompt(`Free time for to-dos on weekdays for ${p.name} (HH:MM-HH:MM), then weekends`, current);
    if (!v) return;
    const w = prompt("Weekends (HH:MM-HH:MM, blank for none)", "09:00-17:00") ?? "";
    const parse = (s: string) => s.split("-").map((x) => x.trim());
    const [ws, we] = parse(v);
    const windows = [1, 2, 3, 4, 5].map((d) => ({ dayOfWeek: d, start: ws, end: we }));
    if (w.trim()) { const [s2, e2] = parse(w); windows.push(...[0, 6].map((d) => ({ dayOfWeek: d, start: s2!, end: e2! }))); }
    await act.run(() => api.put(`${base}/participants/${p.id}/availability`, { windows }));
    reload();
  };
  const addPlace = async (e: FormEvent) => {
    e.preventDefault();
    if (await act.run(() => api.post(`${base}/places`, place))) { setPlace({ name: "", address: "", kind: "other" }); void places.reload(); reload(); }
  };
  const summary = (p: Participant) => {
    if (!p.availability.length) return "no free time set";
    const days = [...new Set(p.availability.map((a) => DAYS[a.dayOfWeek]))].join(" ");
    return `${days} · ${hm(p.availability[0]!.startMinute)}–${hm(p.availability[0]!.endMinute)}`;
  };
  return (
    <div className="stack">
      <h2>People</h2>
      <ul className="items">
        {people.data?.filter((p) => !p.linkedWorkspaceId).map((p) => (
          <li key={p.id} className="item">
            {can.edit ? <input type="color" value={p.color} onChange={(e) => patch(p, { color: e.target.value.toUpperCase() })} aria-label={`${p.name}'s color`} /> : <i className="dot" style={{ background: p.color }} />}
            <div className="grow">
              <b>{p.name}</b> {p.hasLogin && <span className="muted small">has a login</span>}
              <div className="muted small">{p.homePlace ? `starts from ${p.homePlace.name}` : "no home address"} · {summary(p)}</div>
            </div>
            {can.edit && (
              <>
                <label className="row small"><input type="checkbox" checked={p.canDrive} onChange={() => patch(p, { canDrive: !p.canDrive })} /> drives</label>
                <button className="ghost" onClick={() => setHours(p)}>Free time</button>
              </>
            )}
          </li>
        ))}
      </ul>
      {can.edit && (
        <form className="add-row" onSubmit={addPerson}>
          <input required placeholder="Add a person" value={name} onChange={(e) => setName(e.target.value)} aria-label="Name" />
          <button className="primary">Add</button>
        </form>
      )}
      <h2>Places</h2>
      <p className="muted small">Home, school, fields, stores. Used for drive times, leave-by alerts and planning errands.</p>
      <ul className="items">
        {places.data?.map((p) => <li key={p.id} className="item"><div className="grow"><b>{p.name}</b> <span className="muted small">{p.kind}{p.address ? ` · ${p.address}` : ""}</span></div></li>)}
      </ul>
      {can.edit && (
        <form className="add-row wrap" onSubmit={addPlace}>
          <input required placeholder="Name (Home, Eastside Park…)" value={place.name} onChange={(e) => setPlace({ ...place, name: e.target.value })} aria-label="Place name" />
          <input required placeholder="Address" value={place.address} onChange={(e) => setPlace({ ...place, address: e.target.value })} aria-label="Address" />
          <select value={place.kind} onChange={(e) => setPlace({ ...place, kind: e.target.value })} aria-label="Kind">
            {["home", "school", "activity", "store", "work", "other"].map((k) => <option key={k}>{k}</option>)}
          </select>
          <button className="primary">Add place</button>
        </form>
      )}
      {act.error && <p className="error">{act.error}</p>}
    </div>
  );
}

interface Member { id: string; email: string; role: string; participant: { id: string; name: string } | null }

function Members() {
  const { ws, base, can } = useWorkspace();
  const members = useLoad(() => (can.edit ? api.get<Member[]>(`${base}/members`) : Promise.resolve([])), [base]);
  const [inv, setInv] = useState({ role: "member", email: "", participantId: "" });
  const [link, setLink] = useState<string | null>(null);
  const act = useAction();
  if (!can.edit) return <p className="muted">Ask a parent to manage who's in {ws.name}.</p>;
  const invite = async (e: FormEvent) => {
    e.preventDefault();
    await act.run(async () => {
      const r = await api.post<{ url: string }>(`${base}/invites`, { role: inv.role, email: inv.email || undefined, participantId: inv.participantId || undefined });
      setLink(r.url);
    });
  };
  const setRole = async (m: Member, role: string) => { await act.run(() => api.patch(`${base}/members/${m.id}`, { role })); void members.reload(); };
  return (
    <div className="stack">
      <h2>Who's in {ws.name}</h2>
      <ul className="items">
        {members.data?.map((m) => (
          <li key={m.id} className="item">
            <div className="grow"><b>{m.email}</b> {m.participant && <span className="muted small">is {m.participant.name}</span>}</div>
            {can.manage ? (
              <select value={m.role} onChange={(e) => setRole(m, e.target.value)} aria-label="Role">
                <option value="owner">owner</option><option value="member">member</option><option value="viewer">view only</option>
              </select>
            ) : <span className="pill">{m.role}</span>}
          </li>
        ))}
      </ul>
      {can.manage && (
        <form className="card stack" onSubmit={invite}>
          <b>Invite someone</b>
          <div className="row wrap">
            <select value={inv.role} onChange={(e) => setInv({ ...inv, role: e.target.value })} aria-label="Role">
              <option value="member">Member — can add and change things</option>
              <option value="viewer">View only — e.g. kids (can still add to groceries & chores)</option>
              <option value="owner">Owner</option>
            </select>
            {ws.kind === "home" && (
              <select value={inv.participantId} onChange={(e) => setInv({ ...inv, participantId: e.target.value })} aria-label="Who they are">
                <option value="">They are…</option>
                {ws.participants.filter((p) => !p.linkedWorkspaceId).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            )}
            <input type="email" placeholder="Their email (optional)" value={inv.email} onChange={(e) => setInv({ ...inv, email: e.target.value })} aria-label="Email" />
            <button className="primary" disabled={act.busy}>Create link</button>
          </div>
          {link && (
            <div className="row">
              <input readOnly value={link} aria-label="Invite link" onFocus={(e) => e.target.select()} />
              <button type="button" onClick={() => navigator.clipboard?.writeText(link)}>Copy</button>
            </div>
          )}
          <p className="muted small">Links work once and expire in 7 days.</p>
        </form>
      )}
      {act.error && <p className="error">{act.error}</p>}
    </div>
  );
}

function urlB64ToUint8Array(b64: string) {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

function Notifications() {
  const me = useLoad(() => api.get<{ email: string; emailNotifications: boolean; pushDevices: number }>("/me"), []);
  const cfg = useLoad(() => api.get<{ vapidPublicKey: string | null }>("/push/config"), []);
  const act = useAction();
  const supported = "serviceWorker" in navigator && "PushManager" in window;
  const enablePush = () =>
    act.run(async () => {
      if (!cfg.data?.vapidPublicKey) throw new Error("Push isn't set up on the server yet");
      const reg = await navigator.serviceWorker.register("/sw.js");
      if ((await Notification.requestPermission()) !== "granted") throw new Error("Notifications are blocked for this site in your browser settings");
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToUint8Array(cfg.data.vapidPublicKey) });
      await api.post("/me/push-subscriptions", sub.toJSON());
      await me.reload();
    });
  const toggleEmail = () => act.run(async () => { await api.patch("/me", { emailNotifications: !me.data?.emailNotifications }); await me.reload(); });
  return (
    <div className="stack">
      <h2>Notifications</h2>
      <div className="card stack">
        <b>On this device</b>
        <p className="muted small">"Leave by 4:50 for soccer — traffic's heavy" and other time-sensitive alerts. On iPhone, first add Home Base to your Home Screen (Share → Add to Home Screen), then open it from there.</p>
        {supported ? <button className="primary" onClick={enablePush} disabled={act.busy}>Turn on notifications here</button> : <p className="muted">This browser can't receive push notifications.</p>}
        {me.data && <p className="muted small">{me.data.pushDevices} device{me.data.pushDevices === 1 ? "" : "s"} set up.</p>}
      </div>
      <label className="row card"><input type="checkbox" checked={!!me.data?.emailNotifications} onChange={toggleEmail} /> Also email me alerts ({me.data?.email})</label>
      {act.error && <p className="error">{act.error}</p>}
    </div>
  );
}

interface WallDisplay { id: string; name: string; daysAhead: number; showLocations: boolean; lastSeenAt: string | null }

function WallScreens() {
  const { ws, base, can } = useWorkspace();
  const screens = useLoad(() => (can.manage ? api.get<WallDisplay[]>(`${base}/wall-displays`) : Promise.resolve([])), [base]);
  const [form, setForm] = useState({ name: "Kitchen", daysAhead: 4, showLocations: true });
  const [link, setLink] = useState<string | null>(null);
  const act = useAction();
  if (!can.manage) return <p className="muted">An owner can set up a wall screen for {ws.name}.</p>;
  const create = async (e: FormEvent) => {
    e.preventDefault();
    await act.run(async () => setLink((await api.post<{ url: string }>(`${base}/wall-displays`, form)).url));
    void screens.reload();
  };
  const turnOff = async (d: WallDisplay) => {
    if (!confirm(`Turn off “${d.name}”? That screen will stop showing the calendar.`)) return;
    await act.run(() => api.del(`${base}/wall-displays/${d.id}`));
    void screens.reload();
  };
  return (
    <div className="stack">
      <h2>Wall screens</h2>
      <p className="muted">An old tablet or a TV browser in the kitchen: today and the next few days, today's leave-by times, chores and the grocery list. Big type, refreshes itself.</p>
      <div className="card note small">
        Anyone with a wall link can see what's on it — treat it like a house key. It shows no notes, links or emails. Each screen has its own link, so you can turn one off without touching the others.
      </div>
      <ul className="items">
        {screens.data?.map((d) => (
          <li key={d.id} className="item">
            <div className="grow"><b>{d.name}</b> <span className="muted small">{d.daysAhead} days{d.showLocations ? "" : " · no locations"} · {d.lastSeenAt ? `last seen ${fmt(d.lastSeenAt, ws.timeZone, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}` : "not opened yet"}</span></div>
            <button className="ghost" onClick={() => turnOff(d)}>Turn off</button>
          </li>
        ))}
      </ul>
      <form className="card stack" onSubmit={create}>
        <b>Add a screen</b>
        <div className="row wrap">
          <input aria-label="Screen name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <select aria-label="Days" value={form.daysAhead} onChange={(e) => setForm({ ...form, daysAhead: Number(e.target.value) })}>
            {[1, 2, 3, 4, 5, 7].map((n) => <option key={n} value={n}>{n === 1 ? "Today only" : `Today + ${n - 1} days`}</option>)}
          </select>
          <label className="row small"><input type="checkbox" checked={form.showLocations} onChange={(e) => setForm({ ...form, showLocations: e.target.checked })} /> show places</label>
          <button className="primary" disabled={act.busy}>Create link</button>
        </div>
        {link && (
          <div className="stack">
            <div className="row">
              <input readOnly value={link} aria-label="Wall link" onFocus={(e) => e.target.select()} />
              <button type="button" onClick={() => navigator.clipboard?.writeText(link)}>Copy</button>
            </div>
            <p className="muted small">Open this on the screen and bookmark it or add it to the home screen. It's shown only once — make another link for another screen.</p>
          </div>
        )}
      </form>
      {act.error && <p className="error">{act.error}</p>}
    </div>
  );
}
