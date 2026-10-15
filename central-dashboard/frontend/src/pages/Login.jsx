import React, { useState } from "react";
import { api } from "../api/client.js";
import { makeAuthValue, setAuthValue, clearAuth } from "../lib/auth.js";

/**
 * In-app login. Collects the dashboard password (username is accepted but the
 * backend only validates the password), stores it as a Basic credential, then
 * validates it by calling a protected endpoint. On success the app reveals the
 * dashboard; on 401 it shows an inline error (no browser-native prompt).
 */
export default function Login({ onSuccess }) {
  const [user, setUser] = useState("admin");
  const [pass, setPass] = useState("");
  const [remember, setRemember] = useState(false);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setErr("");
    setAuthValue(makeAuthValue(user, pass), remember);
    try {
      await api.account(); // sends the Authorization header we just stored
      onSuccess();
    } catch (ex) {
      clearAuth();
      const msg = String(ex?.message || "");
      setErr(/unauthorized/i.test(msg) ? "Incorrect password. Please try again." : msg || "Sign in failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={submit} autoComplete="on">
        <div className="login-brand">
          <span className="dot" />
          <span>Cloudflare Analytics</span>
        </div>
        <h1 className="login-title">Sign in</h1>
        <p className="login-sub">Enter your dashboard password to view the analytics.</p>

        <label className="login-field">
          <span>Username</span>
          <input
            type="text"
            value={user}
            onChange={(e) => setUser(e.target.value)}
            autoComplete="username"
            spellCheck={false}
          />
        </label>

        <label className="login-field">
          <span>Password</span>
          <input
            type="password"
            value={pass}
            onChange={(e) => setPass(e.target.value)}
            autoComplete="current-password"
            autoFocus
            required
          />
        </label>

        <label className="login-remember">
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
          <span>Remember me on this device</span>
        </label>

        {err && <div className="login-error" role="alert">{err}</div>}

        <button type="submit" className="login-btn" disabled={busy || !pass}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}
