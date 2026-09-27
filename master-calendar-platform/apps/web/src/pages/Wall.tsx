// Kitchen / hallway wall display: no login, no chrome, big type, dark (less glare),
// refreshes every minute and survives Wi-Fi blips by keeping the last good data.
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api, ApiError } from "../lib/api";
import { fmt, time } from "../lib/dates";

interface WallEvent { id: string; title: string; start: string; end: string; allDay: boolean; location: string | null; person: { name: string; color: string } | null; driver: string | null; kind: string | null }
interface WallData {
  household: string;
  timeZone: string;
  generatedAt: string;
  people: { name: string; color: string }[];
  days: { date: string; events: WallEvent[] }[];
  leaveBy: { title: string; driver: string; leaveBy: string; minutes: number; heavyTraffic: boolean }[];
  chores: { id: string; title: string; person: { name: string; color: string } | null }[];
  groceries: string[];
}

const POLL_MS = 60_000;

export function Wall() {
  const { token } = useParams();
  const [data, setData] = useState<WallData | null>(null);
  const [offline, setOffline] = useState(false);
  const [gone, setGone] = useState(false);
  const [now, setNow] = useState(() => new Date());

  // The link is the key: keep it out of Referer headers and search engines.
  useEffect(() => {
    const metas = [["referrer", "no-referrer"], ["robots", "noindex, nofollow"]].map(([name, content]) => {
      const m = document.createElement("meta");
      m.name = name!;
      m.content = content!;
      document.head.appendChild(m);
      return m;
    });
    document.title = "Home Base — wall";
    document.body.classList.add("wall-body");
    return () => {
      metas.forEach((m) => m.remove());
      document.body.classList.remove("wall-body");
    };
  }, []);

  useEffect(() => {
    let stop = false;
    const load = async () => {
      try {
        const d = await api.get<WallData>(`/wall/${token}`);
        if (!stop) {
          setData(d);
          setOffline(false);
        }
      } catch (e) {
        if (e instanceof ApiError && e.status === 404) setGone(true);
        else setOffline(true); // keep showing the last good data
      }
    };
    void load();
    const poll = setInterval(load, POLL_MS);
    const tick = setInterval(() => setNow(new Date()), 15_000);
    return () => {
      stop = true;
      clearInterval(poll);
      clearInterval(tick);
    };
  }, [token]);

  // Keep the screen awake (where supported), and pick up new app versions overnight.
  useEffect(() => {
    let lock: { release: () => Promise<void> } | null = null;
    const nav = navigator as Navigator & { wakeLock?: { request: (t: "screen") => Promise<{ release: () => Promise<void> }> } };
    const grab = () => nav.wakeLock?.request("screen").then((l) => (lock = l)).catch(() => {});
    void grab();
    const onVis = () => document.visibilityState === "visible" && grab();
    document.addEventListener("visibilitychange", onVis);
    const reload = setInterval(() => {
      if (new Date().getHours() === 3) location.reload();
    }, 30 * 60_000);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      clearInterval(reload);
      void lock?.release();
    };
  }, []);

  if (gone) return <div className="wall wall-msg">This screen was turned off.<br /><small>Ask a parent for a new wall link.</small></div>;
  if (!data) return <div className="wall wall-msg">{offline ? "Can't reach Home Base — retrying…" : "Loading…"}</div>;

  const tz = data.timeZone;
  const [today, ...rest] = data.days;
  const stale = offline || now.getTime() - new Date(data.generatedAt).getTime() > 5 * 60_000;
  const leave = data.leaveBy.filter((l) => new Date(l.leaveBy).getTime() > now.getTime() - 10 * 60_000);

  return (
    <div className="wall">
      <header className="wall-head">
        <div>
          <div className="wall-household">{data.household}</div>
          <div className="wall-date">{fmt(now, tz, { weekday: "long", month: "long", day: "numeric" })}</div>
        </div>
        <div className="wall-clock">{time(now, tz)}</div>
      </header>

      {leave.length > 0 && (
        <div className="wall-leave">
          {leave.map((l) => {
            const mins = Math.round((new Date(l.leaveBy).getTime() - now.getTime()) / 60_000);
            return (
              <div key={l.title + l.leaveBy} className={mins <= 10 ? "urgent" : ""}>
                🚗 <b>{l.driver}</b>: leave {mins <= 0 ? "now" : `by ${time(l.leaveBy, tz)}`} for {l.title}
                <span> · {l.minutes} min drive{l.heavyTraffic ? " · heavy traffic" : ""}</span>
              </div>
            );
          })}
        </div>
      )}

      <div className="wall-grid">
        <section className="wall-today">
          <h2>Today</h2>
          {today!.events.length === 0 && <p className="wall-empty">Nothing on the calendar today.</p>}
          {today!.events.map((e) => <WallEventRow key={e.id} e={e} tz={tz} now={now} big />)}
        </section>
        <section className="wall-next">
          {rest.map((d) => (
            <div key={d.date} className="wall-day">
              <h3>{fmt(`${d.date}T12:00:00Z`, "UTC", { weekday: "long" })}</h3>
              {d.events.length === 0 && <p className="wall-empty">—</p>}
              {d.events.map((e) => <WallEventRow key={e.id} e={e} tz={tz} now={now} />)}
            </div>
          ))}
        </section>
        <aside className="wall-side">
          {data.chores.length > 0 && (
            <div>
              <h3>Chores</h3>
              <ul>
                {data.chores.map((c) => (
                  <li key={c.id}><i style={{ background: c.person?.color ?? "#6b7280" }} /><div>{c.title}{c.person && <span> · {c.person.name}</span>}</div></li>
                ))}
              </ul>
            </div>
          )}
          {data.groceries.length > 0 && (
            <div>
              <h3>Groceries ({data.groceries.length})</h3>
              <p className="wall-groceries">{data.groceries.join(" · ")}</p>
            </div>
          )}
          <div className="wall-people">
            {data.people.map((p) => <span key={p.name}><i style={{ background: p.color }} />{p.name}</span>)}
          </div>
        </aside>
      </div>
      <footer className={`wall-foot ${stale ? "stale" : ""}`}>
        {stale ? `Offline — showing ${time(data.generatedAt, tz)}` : `Updated ${time(data.generatedAt, tz)}`}
      </footer>
    </div>
  );
}

function WallEventRow({ e, tz, now, big }: { e: WallEvent; tz: string; now: Date; big?: boolean }) {
  const past = !e.allDay && new Date(e.end) < now;
  const happening = !e.allDay && new Date(e.start) <= now && new Date(e.end) > now;
  return (
    <div className={`wall-event ${big ? "big" : ""} ${past ? "past" : ""} ${happening ? "now" : ""}`} style={{ ["--c" as string]: e.person?.color ?? "#9aa1ad" }}>
      <div className="wall-time">{e.allDay ? "All day" : time(e.start, tz)}</div>
      <div className="wall-what">
        <div className="wall-title">{e.title}</div>
        <div className="wall-sub">
          {e.person?.name ?? "Nobody yet"}
          {e.location ? ` · ${e.location}` : ""}
          {e.driver ? ` · 🚗 ${e.driver}` : ""}
        </div>
      </div>
    </div>
  );
}
