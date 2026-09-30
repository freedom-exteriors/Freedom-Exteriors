import { useState, useEffect } from "react";
import { supabase } from "./supabase";
import Login from "./Login";
import Pipeline from "./Pipeline";
import Portal from "./portal";
import SetPassword from "./SetPassword";

// A password-reset email link lands on /reset-password with the recovery token
// (or an error, e.g. an expired link) in the URL fragment.
const RESET_PATH = "/reset-password";
const linkParams = () => new URLSearchParams(window.location.hash.replace(/^#/, ""));

export default function App() {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [recovery, setRecovery] = useState(() => window.location.pathname === RESET_PATH || linkParams().get("type") === "recovery");
  const [resetLinkError] = useState(() => (window.location.pathname === RESET_PATH ? linkParams().get("error_description") : null));

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY") setRecovery(true);
      setSession(session);
    });

    // Back from connecting QuickBooks / Hover: say how it went, then tidy the URL.
    // (Tokens stay on the server; older versions kept them in localStorage.)
    ["qb_token", "qb_realm", "qb_refresh_token"].forEach(k => localStorage.removeItem(k));
    const params = new URLSearchParams(window.location.search);
    const result = { connected: "connected", cancelled: "wasn't connected (cancelled)", expired: "wasn't connected — the login took too long, please try again", failed: "couldn't be connected — please try again" };
    const qb = params.get("qb");
    const hover = params.get("hover");
    if (qb || hover) {
      window.history.replaceState({}, "", "/");
      setTimeout(() => alert(`${qb ? "QuickBooks" : "Hover"} ${result[qb || hover] || "connection finished"}.`), 300);
    }

    return () => subscription.unsubscribe();
  }, []);

  const path = window.location.pathname;
  const portalMatch = path.match(/^\/portal\/(.+)$/);
  if (portalMatch) return <Portal token={portalMatch[1]} />;

  if (loading) return (
    <div style={{ minHeight:"100vh", background:"#080d14", display:"flex", alignItems:"center", justifyContent:"center", fontFamily:"'Barlow Condensed','Segoe UI',sans-serif" }}>
      <div style={{ fontWeight:800, fontSize:28, letterSpacing:4 }}>
        <span style={{ color:"#1a9e99" }}>FREEDOM </span>
        <span style={{ color:"#e8a820" }}>EXTERIORS</span>
      </div>
    </div>
  );

  if (recovery) {
    return <SetPassword session={session} linkError={resetLinkError} onDone={() => {
      window.history.replaceState({}, "", "/");
      setRecovery(false);
      if (resetLinkError) supabase.auth.signOut();
    }} />;
  }

  return session ? <Pipeline session={session} /> : <Login />;
}
