import { useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useAction } from "../lib/hooks";

function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="auth">
      <div className="auth-card card">
        <div className="brand"><img src="/icon.svg" alt="" /> Home Base</div>
        <h1>{title}</h1>
        {children}
      </div>
    </div>
  );
}

export function Login() {
  const { refresh } = useAuth();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const { busy, error, run } = useAction();
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (await run(() => api.post("/auth/login", { email, password }))) {
      await refresh();
      nav(params.get("next") || "/", { replace: true });
    }
  };
  return (
    <Shell title="Sign in">
      <form onSubmit={submit} className="stack">
        <label>Email<input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></label>
        <label>Password<input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></label>
        {error && <p className="error" role="alert">{error}</p>}
        <button className="primary" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
      </form>
      <p className="muted">New here? <Link to={`/signup${params.get("next") ? `?next=${encodeURIComponent(params.get("next")!)}` : ""}`}>Create an account</Link></p>
    </Shell>
  );
}

export function Signup() {
  const { refresh } = useAuth();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const joining = (params.get("next") ?? "").startsWith("/invite/");
  const [form, setForm] = useState({ email: "", password: "", displayName: "", workspaceName: "", vertical: "family" });
  const { busy, error, run } = useAction();
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm({ ...form, [k]: e.target.value });
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    let workspaceId: string | null = null;
    const ok = await run(async () => {
      const r = await api.post<{ workspaceId: string | null }>("/auth/signup", {
        email: form.email,
        password: form.password,
        displayName: form.displayName || undefined,
        workspace: joining ? undefined : { name: form.workspaceName || `${form.displayName || "My"} ${form.vertical === "family" ? "Family" : form.vertical === "student" ? "Calendar" : "Business"}`, vertical: form.vertical },
      });
      workspaceId = r.workspaceId;
    });
    if (ok) {
      await refresh();
      nav(params.get("next") || (workspaceId ? `/w/${workspaceId}/settings/calendars?welcome=1` : "/"), { replace: true });
    }
  };
  return (
    <Shell title={joining ? "Create your account to join" : "Set up your home base"}>
      <form onSubmit={submit} className="stack">
        <label>Your name<input required value={form.displayName} onChange={set("displayName")} placeholder="Alex" /></label>
        <label>Email<input type="email" autoComplete="email" required value={form.email} onChange={set("email")} /></label>
        <label>Password <span className="muted">(8+ characters)</span><input type="password" autoComplete="new-password" minLength={8} required value={form.password} onChange={set("password")} /></label>
        {!joining && (
          <>
            <label>This is for
              <select value={form.vertical} onChange={set("vertical")}>
                <option value="family">My family</option>
                <option value="student">Me, as a student</option>
                <option value="business">My small business</option>
              </select>
            </label>
            <label>Name it <span className="muted">(optional)</span><input value={form.workspaceName} onChange={set("workspaceName")} placeholder="The Rivera Family" /></label>
          </>
        )}
        {error && <p className="error" role="alert">{error}</p>}
        <button className="primary" disabled={busy}>{busy ? "Creating…" : "Create account"}</button>
      </form>
      <p className="muted">Already have an account? <Link to={`/login${params.get("next") ? `?next=${encodeURIComponent(params.get("next")!)}` : ""}`}>Sign in</Link></p>
    </Shell>
  );
}
