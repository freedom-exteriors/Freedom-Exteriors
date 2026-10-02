"use client";
import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

function LoginForm() {
  const router = useRouter();
  const next = useSearchParams().get("next");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    setBusy(false);
    if (res.ok) {
      // Only allow same-site paths as the redirect target.
      router.replace(next && next.startsWith("/") && !next.startsWith("//") ? next : "/");
      return;
    }
    const body = await res.json().catch(() => ({}));
    setError(body.error ?? "Sign-in failed.");
  }

  return (
    <div className="login-wrap card">
      <h1 style={{ color: "var(--teal)" }}>Freedom Exteriors</h1>
      <p className="muted">Invoice Project. Enter the shared password.</p>
      {error && <div className="alert error">{error}</div>}
      <form onSubmit={submit}>
        <label htmlFor="pw">Password</label>
        <input id="pw" type="password" autoFocus autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        <div className="actions">
          <button type="submit" disabled={busy || !password}>{busy ? "Signing in…" : "Sign in"}</button>
        </div>
      </form>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
