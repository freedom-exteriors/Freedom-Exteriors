import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { useAction } from "../lib/hooks";
import type { CalEvent } from "../lib/types";
import { useWorkspace } from "./WorkspaceLayout";
import { fmt, time } from "../lib/dates";

export function EventDrawer({ eventId, initial, onClose, onChanged }: { eventId: string; initial?: CalEvent; onClose: () => void; onChanged: () => void }) {
  const { ws, base, can } = useWorkspace();
  const tz = ws.timeZone;
  const [e, setE] = useState<CalEvent | null>(initial ?? null);
  const act = useAction();
  useEffect(() => {
    if (!initial) api.get<CalEvent>(`${base}/events/${eventId}`).then(setE).catch(() => onClose());
  }, [eventId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const k = (ev: KeyboardEvent) => ev.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  if (!e) return null;

  const people = ws.participants.filter((p) => !p.linkedWorkspaceId);
  const drivers = people.filter((p) => p.canDrive);
  const update = (patch: Record<string, string | null>) =>
    act.run(async () => {
      setE(await api.patch<CalEvent>(`${base}/events/${e.id}`, patch));
      onChanged();
    });
  const editable = can.edit && e.editable;
  const when = e.allDay
    ? fmt(e.start, tz, { weekday: "long", month: "long", day: "numeric" })
    : `${fmt(e.start, tz, { weekday: "long", month: "long", day: "numeric" })}, ${time(e.start, tz)}–${time(e.end, tz)}`;

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <aside className="drawer card" role="dialog" aria-label={e.title} onClick={(ev) => ev.stopPropagation()}>
        <div className="row between">
          <h2>{e.title}</h2>
          <button className="ghost" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <p>{when}</p>
        {e.location && <p>📍 {e.location}</p>}
        {e.description && <p className="muted pre">{e.description}</p>}
        <p className="muted small">From {e.source.name ?? e.source.type}{e.circle ? ` · shared in ◎ ${e.circle.name}` : ""}{e.url ? <> · <a href={e.url} target="_blank" rel="noreferrer">open original</a></> : null}</p>

        {editable ? (
          <div className="stack">
            <label>Who's this for
              <select value={e.participant?.id ?? ""} onChange={(ev) => update({ participantId: ev.target.value || null })}>
                <option value="">Nobody yet</option>
                {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </label>
            <label>What kind
              <select value={e.tag?.id ?? ""} onChange={(ev) => update({ eventTagId: ev.target.value || null })}>
                <option value="">—</option>
                {ws.tags.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
              </select>
            </label>
            {!e.allDay && (
              <label>Who's driving
                <select value={e.driver?.id ?? ""} onChange={(ev) => update({ driverParticipantId: ev.target.value || null })}>
                  <option value="">{e.needsDriver ? "Nobody yet — needs a driver" : "—"}</option>
                  {drivers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </label>
            )}
            {drivers.length === 0 && !e.allDay && <p className="muted small">Mark who can drive in Settings → People.</p>}
            {act.error && <p className="error">{act.error}</p>}
          </div>
        ) : (
          <dl className="facts">
            <dt>For</dt><dd>{e.participant?.name ?? "Nobody yet"}</dd>
            <dt>Kind</dt><dd>{e.tag?.label ?? "—"}</dd>
            {!e.allDay && <><dt>Driving</dt><dd>{e.driver?.name ?? (e.needsDriver ? "Needs a driver" : "—")}</dd></>}
            {!e.editable && <><dt /><dd className="muted small">Change this in the circle.</dd></>}
          </dl>
        )}
      </aside>
    </div>
  );
}
