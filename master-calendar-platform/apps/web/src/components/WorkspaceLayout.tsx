import { createContext, useContext } from "react";
import { NavLink, Outlet, useNavigate, useParams } from "react-router-dom";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useLoad } from "../lib/hooks";
import type { WorkspaceDetail } from "../lib/types";
import { Bell } from "./Bell";

interface WorkspaceCtx {
  ws: WorkspaceDetail;
  base: string; // "/workspaces/:id" API prefix
  can: { edit: boolean; manage: boolean };
  reloadWorkspace: () => Promise<void>;
}
const Ctx = createContext<WorkspaceCtx | null>(null);
export function useWorkspace() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useWorkspace outside WorkspaceLayout");
  return c;
}

const NAV = [
  ["calendar", "Calendar"],
  ["lists", "Lists"],
  ["groceries", "Shopping"],
  ["plan", "Plan"],
  ["goals", "Goals"],
  ["photos", "Photos"],
  ["settings", "Settings"],
] as const;

export function WorkspaceLayout() {
  const { workspaceId } = useParams();
  const { me, logout } = useAuth();
  const nav = useNavigate();
  const { data: ws, error, reload } = useLoad(() => api.get<WorkspaceDetail>(`/workspaces/${workspaceId}`), [workspaceId]);

  if (error) return <div className="center"><p className="error">{error}</p><a href="/">Back</a></div>;
  if (!ws) return <div className="center muted">Loading…</div>;
  const can = { edit: ws.myRole !== "viewer", manage: ws.myRole === "owner" };

  return (
    <Ctx.Provider value={{ ws, base: `/workspaces/${ws.id}`, can, reloadWorkspace: reload }}>
      <div className="app">
        <header className="topbar">
          <div className="brand small"><img src="/icon.svg" alt="" /></div>
          <select className="ws-switch" aria-label="Switch household" value={ws.id} onChange={(e) => nav(`/w/${e.target.value}/calendar`)}>
            {me?.workspaces.map((w) => <option key={w.id} value={w.id}>{w.kind === "circle" ? "◎ " : ""}{w.name}</option>)}
          </select>
          {ws.myRole === "viewer" && <span className="pill">view only</span>}
          <div className="spacer" />
          <Bell />
          <button className="ghost signout" aria-label="Sign out" title="Sign out" onClick={async () => { await logout(); nav("/login"); }}>
            <span className="wide-only">Sign out</span><svg className="narrow-only" aria-hidden width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="M16 17l5-5-5-5" /><path d="M21 12H9" /></svg>
          </button>
        </header>
        <nav className="tabs" aria-label="Sections">
          {NAV.map(([path, label]) => (
            <NavLink key={path} to={path} className={({ isActive }) => (isActive ? "active" : "")}>{label}</NavLink>
          ))}
        </nav>
        <main className="content">
          <Outlet />
        </main>
      </div>
    </Ctx.Provider>
  );
}
