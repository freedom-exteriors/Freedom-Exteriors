import { Navigate } from "react-router-dom";
import { useAuth } from "../lib/auth";

/** Land in the first household (circles are reached from the switcher). */
export function Home() {
  const { me } = useAuth();
  const first = me?.workspaces.find((w) => w.kind === "home") ?? me?.workspaces[0];
  if (!first) {
    return (
      <div className="auth"><div className="card auth-card"><h1>No household yet</h1><p>Ask someone for an invite link, or sign out and create a new account.</p></div></div>
    );
  }
  return <Navigate to={`/w/${first.id}/calendar`} replace />;
}
