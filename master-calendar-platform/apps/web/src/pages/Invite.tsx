import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useAction, useLoad } from "../lib/hooks";

interface Preview { workspace: { name: string; kind: "home" | "circle" }; role: string; participantName: string | null; restrictedToEmail: boolean }

export function AcceptInvite() {
  const { token } = useParams();
  const { me, refresh } = useAuth();
  const nav = useNavigate();
  const { data, error } = useLoad(() => api.get<Preview>(`/invites/${token}`), [token]);
  const homes = me?.workspaces.filter((w) => w.kind === "home" && w.role !== "viewer") ?? [];
  const [homeId, setHomeId] = useState("");
  const act = useAction();
  const next = encodeURIComponent(`/invite/${token}`);

  if (error) return <div className="auth"><div className="card auth-card"><h1>Invite not found</h1><p>{error}. Ask for a new link.</p><Link to="/">Home</Link></div></div>;
  if (!data) return <div className="center muted">Loading…</div>;
  const accept = async () => {
    let wsId = "";
    const ok = await act.run(async () => {
      wsId = (await api.post<{ workspaceId: string }>(`/invites/${token}/accept`, data.workspace.kind === "circle" ? { homeWorkspaceId: homeId || homes[0]?.id } : {})).workspaceId;
    });
    if (ok) {
      await refresh();
      nav(`/w/${wsId}/calendar`, { replace: true });
    }
  };
  return (
    <div className="auth">
      <div className="card auth-card stack">
        <div className="brand"><img src="/icon.svg" alt="" /> Home Base</div>
        <h1>Join {data.workspace.name}</h1>
        <p>
          {data.workspace.kind === "circle" ? "Plan together with other households" : "You're invited"} as a <b>{data.role}</b>
          {data.participantName ? <> — you'll be <b>{data.participantName}</b> on the calendar</> : null}.
        </p>
        {!me ? (
          <div className="row">
            <Link className="button primary" to={`/signup?next=${next}`}>Create account</Link>
            <Link className="button" to={`/login?next=${next}`}>I have an account</Link>
          </div>
        ) : (
          <>
            {data.workspace.kind === "circle" && (
              homes.length ? (
                <label>Joining as
                  <select value={homeId || homes[0]!.id} onChange={(e) => setHomeId(e.target.value)}>
                    {homes.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
                  </select>
                </label>
              ) : <p className="error">Set up your own household first, then open this link again.</p>
            )}
            {act.error && <p className="error">{act.error}</p>}
            <button className="primary" onClick={accept} disabled={act.busy || (data.workspace.kind === "circle" && !homes.length)}>Join</button>
          </>
        )}
      </div>
    </div>
  );
}
