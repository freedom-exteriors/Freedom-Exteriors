import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, apiUrl } from "../lib/api";
import { useAction, useLoad } from "../lib/hooks";
import type { Candidate, Photo } from "../lib/types";
import { useWorkspace } from "../components/WorkspaceLayout";
import { fmt, fromLocalInput, time, toLocalInput } from "../lib/dates";

export function PhotosPage() {
  const { base, ws } = useWorkspace();
  const photos = useLoad(() => api.get<Photo[]>(`${base}/schedule-photos`), [base]);
  const input = useRef<HTMLInputElement>(null);
  const act = useAction();
  const nav = useNavigate();
  const upload = async (file: File) => {
    const form = new FormData();
    form.append("file", file);
    let id = "";
    if (await act.run(async () => { id = (await api.upload<Photo>(`${base}/schedule-photos?wait=true`, form)).id; })) nav(id);
    void photos.reload();
  };
  return (
    <section>
      <div className="toolbar">
        <h2>Snap a schedule</h2>
        <button className="primary" onClick={() => input.current?.click()} disabled={act.busy}>{act.busy ? "Reading…" : "📷 Add a photo"}</button>
        <input ref={input} type="file" accept="image/*,application/pdf" capture="environment" hidden onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
      </div>
      <p className="muted">Team schedules, school notices, flyers, appointment cards. You'll check every event before anything goes on the calendar.</p>
      {act.error && <p className="error">{act.error}</p>}
      <ul className="photo-list">
        {photos.data?.map((p) => (
          <li key={p.id} className="card">
            <Link to={p.id} className="row">
              <img src={apiUrl(p.imageUrl)} alt="" className="thumb" />
              <div className="grow">
                <b>{fmt(p.createdAt, ws.timeZone, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</b>
                <div className="muted small">
                  {p.status === "completed" ? `${p.counts.pending} to review · ${p.counts.confirmed} added` : p.status === "failed" ? `Couldn't read: ${p.errorMessage}` : "Reading…"}
                </div>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function PhotoReview() {
  const { photoId } = useParams();
  const { base, ws, can } = useWorkspace();
  const tz = ws.timeZone;
  const P = `${base}/schedule-photos/${photoId}`;
  const photo = useLoad(() => api.get<Photo>(P), [P]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<string | null>(null);
  const act = useAction();
  const cands = photo.data?.candidates ?? [];
  const pending = cands.filter((c) => c.status === "pending");

  // Pre-select confident ones; low-confidence ones need a deliberate tick.
  useEffect(() => {
    setPicked(new Set(pending.filter((c) => !c.lowConfidence || c.edited).map((c) => c.id)));
  }, [photo.data]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (photo.data && (photo.data.status === "pending" || photo.data.status === "processing")) {
      const t = setTimeout(() => void photo.reload(), 3000);
      return () => clearTimeout(t);
    }
  }, [photo.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (id: string) => setPicked((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const chosen = pending.filter((c) => picked.has(c.id));
  const risky = chosen.filter((c) => c.lowConfidence && !c.edited);
  const confirm = async () => {
    if (risky.length && !window.confirm(`${risky.length} of these were hard to read. Add them anyway?`)) return;
    await act.run(() => api.post(`${P}/confirm`, { candidateIds: chosen.map((c) => c.id), confirmLowConfidence: risky.length > 0 }));
    void photo.reload();
  };
  const reject = async () => {
    await act.run(() => api.post(`${P}/reject`, { candidateIds: pending.filter((c) => !picked.has(c.id)).map((c) => c.id) }));
    void photo.reload();
  };
  if (!photo.data) return <p className="muted">Loading…</p>;
  const p = photo.data;

  return (
    <section className="review">
      <div className="toolbar"><Link to="..">‹ All photos</Link></div>
      <div className="review-grid">
        <img src={apiUrl(p.imageUrl)} alt="Uploaded schedule" className="review-img" />
        <div>
          {p.status === "failed" && (
            <div className="card note">
              <p className="error">{p.errorMessage}</p>
              {can.edit && <button onClick={async () => { await act.run(() => api.post(`${P}/retry`)); void photo.reload(); }}>Try again</button>}
            </div>
          )}
          {(p.status === "pending" || p.status === "processing") && <p className="muted">Reading the photo…</p>}
          {p.notes && <p className="card note">📝 {p.notes}</p>}
          {p.status === "completed" && cands.length === 0 && <p className="muted">No events found in this photo.</p>}
          <ul className="cands">
            {cands.map((c) => (
              <li key={c.id} className={`card cand ${c.status} ${c.lowConfidence && !c.edited ? "low" : ""}`}>
                {c.status === "pending" && can.edit ? (
                  <input type="checkbox" checked={picked.has(c.id)} onChange={() => toggle(c.id)} aria-label={`Add ${c.title}`} />
                ) : <span className="cand-status">{c.status === "confirmed" ? "✓" : c.status === "rejected" ? "—" : ""}</span>}
                <div className="grow">
                  {editing === c.id ? (
                    <CandidateEditor c={c} tz={tz} onDone={() => { setEditing(null); void photo.reload(); }} />
                  ) : (
                    <>
                      <b>{c.title}</b>
                      <div>{c.allDay ? `${fmt(c.start, tz, { weekday: "short", month: "short", day: "numeric" })} · all day` : `${fmt(c.start, tz, { weekday: "short", month: "short", day: "numeric" })} · ${time(c.start, tz)}–${time(c.end, tz)}`}{c.location ? ` · ${c.location}` : ""}</div>
                      <div className="muted small">
                        {ws.participants.find((x) => x.id === c.participantId)?.name ?? "Nobody yet"}
                        {c.eventTagId ? ` · ${ws.tags.find((t) => t.id === c.eventTagId)?.label}` : ""}
                        {" · "}read: “{c.sourceText}”
                      </div>
                      {c.lowConfidence && !c.edited && <div className="warn small">⚠ Hard to read ({Math.round(c.confidence * 100)}%) — check it</div>}
                      {c.assumptions.map((a) => <div key={a} className="muted small">• {a}</div>)}
                    </>
                  )}
                </div>
                {c.status === "pending" && can.edit && editing !== c.id && <button className="ghost" onClick={() => setEditing(c.id)}>Edit</button>}
              </li>
            ))}
          </ul>
          {pending.length > 0 && can.edit && (
            <div className="row actions">
              <button className="primary" disabled={!chosen.length || act.busy} onClick={confirm}>Add {chosen.length} to calendar</button>
              {pending.length > chosen.length && <button onClick={reject} disabled={act.busy}>Skip the rest</button>}
            </div>
          )}
          {pending.length > 0 && !can.edit && <p className="muted">A parent will review these before they're added.</p>}
          {act.error && <p className="error">{act.error}</p>}
        </div>
      </div>
    </section>
  );
}

function CandidateEditor({ c, tz, onDone }: { c: Candidate; tz: string; onDone: () => void }) {
  const { ws, base } = useWorkspace();
  const { photoId } = useParams();
  const [f, setF] = useState({ title: c.title, start: toLocalInput(c.start, tz), end: toLocalInput(c.end, tz), location: c.location ?? "", participantId: c.participantId ?? "", eventTagId: c.eventTagId ?? "" });
  const act = useAction();
  const save = async () => {
    if (await act.run(() => api.patch(`${base}/schedule-photos/${photoId}/candidates/${c.id}`, {
      title: f.title,
      start: fromLocalInput(f.start, tz),
      end: fromLocalInput(f.end, tz),
      location: f.location || null,
      participantId: f.participantId || null,
      eventTagId: f.eventTagId || null,
    }))) onDone();
  };
  return (
    <div className="stack">
      <input aria-label="Title" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
      <div className="row wrap">
        <input type="datetime-local" aria-label="Start" value={f.start} onChange={(e) => setF({ ...f, start: e.target.value })} />
        <input type="datetime-local" aria-label="End" value={f.end} onChange={(e) => setF({ ...f, end: e.target.value })} />
      </div>
      <input aria-label="Location" placeholder="Location" value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} />
      <div className="row wrap">
        <select aria-label="Who" value={f.participantId} onChange={(e) => setF({ ...f, participantId: e.target.value })}>
          <option value="">Nobody yet</option>
          {ws.participants.filter((p) => !p.linkedWorkspaceId).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <select aria-label="Kind" value={f.eventTagId} onChange={(e) => setF({ ...f, eventTagId: e.target.value })}>
          <option value="">—</option>
          {ws.tags.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
        </select>
      </div>
      {act.error && <p className="error">{act.error}</p>}
      <div className="row"><button className="primary" onClick={save} disabled={act.busy}>Save</button><button className="ghost" onClick={onDone}>Cancel</button></div>
    </div>
  );
}
