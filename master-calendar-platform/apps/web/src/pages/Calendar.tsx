import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../lib/api";
import { useLoad } from "../lib/hooks";
import type { CalEvent } from "../lib/types";
import { useWorkspace } from "../components/WorkspaceLayout";
import { EventDrawer } from "../components/EventDrawer";
import { addDays, dayLabel, dayOf, fmt, monthStart, sameDay, time, today, weekStart, type LocalDay } from "../lib/dates";

type View = "week" | "month";

export function CalendarPage() {
  const { ws, base } = useWorkspace();
  const tz = ws.timeZone;
  const { eventId } = useParams();
  const navigate = useNavigate();
  const [view, setView] = useState<View>("week");
  const [anchor, setAnchor] = useState<LocalDay>(() => today(tz));
  const [who, setWho] = useState<string>("all");
  const [selected, setSelected] = useState<string | null>(eventId ?? null);

  const range = useMemo(() => {
    if (view === "week") {
      // A rolling 7 days from the anchor (today by default): on a Sunday, families want
      // to see the week ahead, not the one that's ending.
      return { start: anchor, days: Array.from({ length: 7 }, (_, i) => addDays(anchor, i, tz)) };
    }
    const first = monthStart(anchor, tz);
    const s = weekStart(first, tz);
    return { start: s, days: Array.from({ length: 42 }, (_, i) => addDays(s, i, tz)) };
  }, [view, anchor, tz]);
  const end = range.days[range.days.length - 1]!.end;

  const qs = new URLSearchParams({ start: range.start.start.toISOString(), end: end.toISOString() });
  if (who === "unassigned") qs.set("assigned", "unassigned");
  else if (who !== "all") qs.set("participantId", who);
  const { data, reload } = useLoad(() => api.get<{ events: CalEvent[] }>(`${base}/events?${qs}`), [base, qs.toString()]);
  const events = data?.events ?? [];

  const byDay = (d: LocalDay) => events.filter((e) => new Date(e.start) < d.end && (new Date(e.end) > d.start || e.start === e.end && new Date(e.start) >= d.start));
  const step = (n: number) => setAnchor(view === "week" ? addDays(anchor, 7 * n, tz) : dayOf(new Date(Date.UTC(anchor.year, anchor.month - 1 + n, 15, 12)), tz));
  const now = today(tz);
  const title = view === "week"
    ? `${fmt(range.days[0]!.start, tz, { month: "short", day: "numeric" })} – ${fmt(range.days[6]!.start, tz, { month: "short", day: "numeric", year: "numeric" })}`
    : fmt(monthStart(anchor, tz).start, tz, { month: "long", year: "numeric" });
  const open = (id: string) => setSelected(id);
  const close = () => {
    setSelected(null);
    if (eventId) navigate("../calendar", { relative: "path" });
  };
  const unassignedCount = events.filter((e) => e.unassigned || e.needsDriver).length;

  return (
    <section>
      <div className="toolbar">
        <div className="row">
          <button onClick={() => step(-1)} aria-label="Previous">‹</button>
          <button onClick={() => setAnchor(today(tz))}>Today</button>
          <button onClick={() => step(1)} aria-label="Next">›</button>
          <h2 className="range-title">{title}</h2>
        </div>
        <div className="row">
          <select aria-label="Show" value={who} onChange={(e) => setWho(e.target.value)}>
            <option value="all">Everyone</option>
            <option value="unassigned">Needs someone</option>
            {ws.participants.filter((p) => !p.linkedWorkspaceId).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <div className="segmented" role="group" aria-label="View">
            <button className={view === "week" ? "on" : ""} onClick={() => setView("week")}>Week</button>
            <button className={view === "month" ? "on" : ""} onClick={() => setView("month")}>Month</button>
          </div>
        </div>
      </div>

      <div className="legend">
        {ws.participants.filter((p) => !p.linkedWorkspaceId).map((p) => (
          <span key={p.id}><i style={{ background: p.color }} />{p.name}</span>
        ))}
        <span><i className="hatch" />Nobody yet</span>
        {unassignedCount > 0 && <span className="pill warn">{unassignedCount} need{unassignedCount === 1 ? "s" : ""} someone</span>}
      </div>

      {view === "week" ? (
        <div className="week">
          {range.days.map((d) => (
            <div key={d.start.toISOString()} className={`day ${sameDay(d, now) ? "today" : ""}`}>
              <div className="day-head">{dayLabel(d, tz)}</div>
              {byDay(d).map((e) => <EventChip key={e.id + d.start.toISOString()} e={e} tz={tz} onClick={() => open(e.id)} />)}
              {byDay(d).length === 0 && sameDay(d, now) && <span className="muted small">Nothing scheduled today</span>}
            </div>
          ))}
        </div>
      ) : (
        <div className="month">
          {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => <div key={d} className="month-head">{d}</div>)}
          {range.days.map((d) => {
            const list = byDay(d);
            return (
              <div key={d.start.toISOString()} className={`cell ${d.month !== anchor.month ? "other" : ""} ${sameDay(d, now) ? "today" : ""}`}>
                <div className="num">{d.day}</div>
                {list.slice(0, 3).map((e) => <EventChip key={e.id} e={e} tz={tz} compact onClick={() => open(e.id)} />)}
                {list.length > 3 && <button className="link more" onClick={() => { setAnchor(d); setView("week"); }}>+{list.length - 3} more</button>}
              </div>
            );
          })}
        </div>
      )}
      {selected && <EventDrawer eventId={selected} initial={events.find((e) => e.id === selected)} onClose={close} onChanged={reload} />}
    </section>
  );
}

function EventChip({ e, tz, compact, onClick }: { e: CalEvent; tz: string; compact?: boolean; onClick: () => void }) {
  const color = e.participant?.color ?? "#9aa1ad";
  return (
    <button
      className={`chip ${e.unassigned ? "unassigned" : ""} ${compact ? "compact" : ""}`}
      style={{ ["--c" as string]: color }}
      onClick={onClick}
      title={e.title}
    >
      <span className="chip-time">{e.allDay ? "All day" : time(e.start, tz)}</span>
      <span className="chip-title">{e.title}</span>
      {!compact && (
        <span className="chip-meta">
          {e.unassigned ? "Nobody yet" : e.participant?.name}
          {e.tag ? ` · ${e.tag.label}` : ""}
          {e.circle ? ` · ◎ ${e.circle.name}` : ""}
        </span>
      )}
      {e.needsDriver && <span className="chip-flag" title="Needs a driver">🚗?</span>}
    </button>
  );
}
