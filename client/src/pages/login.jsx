import { useState } from "react";
import { useNavigate, useParams, Link } from "react-router-dom";
import { auth } from "../auth";

function titleCase(s) {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

async function jsonOrThrow(res, fallback = "Request failed") {
  let data = null;
  try { data = await res.json(); } catch {}
  if (!res.ok) throw new Error((data && data.error) || fallback);
  return data;
}

export default function Login() {
  const nav = useNavigate();
  const { who } = useParams();
  const role = who === "doctor" ? "doctor" : "patient";

  const [email, setEmail] = useState(
    role === "patient" ? "patient@example.com" : "doctor@example.com"
  );
  const [password, setPassword] = useState(
    role === "patient" ? "patient123" : "doctor123"
  );
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const already = auth.isLoggedIn();
  const currentRole = auth.role();

  async function onSubmit(e) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), password, role }),
      });
      const data = await jsonOrThrow(res, "Login failed");
      auth.save(data);
      nav(role === "doctor" ? "/doctor" : "/patient", { replace: true });
    } catch (err) {
      setError(err.message || "Login failed");
    } finally {
      setBusy(false);
    }
  }

  function signOutAndStay() {
    auth.clear();
    nav(`/login/${role}`, { replace: true });
  }

  return (
    <div className="max-w-md mx-auto">
      {/* Nav links */}
      <div className="flex items-center gap-3 mb-6">
        <button
          type="button"
          onClick={() => nav("/")}
          className="text-sm text-text-muted hover:text-primary-600 transition-colors cursor-pointer"
        >
          &larr; Home
        </button>
        <div className="flex items-center gap-2 text-sm">
          <Link to="/login/patient" className={`font-medium transition-colors ${role === "patient" ? "text-primary-600" : "text-text-muted hover:text-primary-600"}`}>
            Patient
          </Link>
          <span className="text-border">|</span>
          <Link to="/login/doctor" className={`font-medium transition-colors ${role === "doctor" ? "text-teal-600" : "text-text-muted hover:text-teal-600"}`}>
            Doctor
          </Link>
          <span className="text-border">|</span>
          <Link to="/signup" className="text-text-muted hover:text-primary-600 transition-colors">
            Create account
          </Link>
        </div>
      </div>

      <h1 className="text-2xl font-bold text-text mb-6">
        Sign in as {titleCase(role)}
      </h1>

      {already && (
        <div className="mb-5 p-4 bg-amber-50 border border-amber-200 rounded-lg flex items-center justify-between">
          <span className="text-sm text-amber-800">
            Currently signed in as <strong className="capitalize">{currentRole}</strong>
          </span>
          <button
            onClick={signOutAndStay}
            className="text-sm text-red-600 hover:text-red-700 hover:bg-red-50 px-3 py-1.5 rounded-md transition-colors cursor-pointer"
          >
            Sign out to switch
          </button>
        </div>
      )}

      <div className="bg-white border border-border rounded-xl shadow-sm p-6">
        <form onSubmit={onSubmit} className="space-y-5">
          <div>
            <label className="block text-sm font-medium text-text-muted mb-1.5">
              Email
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="username"
              disabled={busy || already}
              className="w-full px-3 py-2.5 rounded-lg border border-border bg-white text-text placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent transition disabled:bg-slate-100 disabled:opacity-60"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-text-muted mb-1.5">
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
              disabled={busy || already}
              className="w-full px-3 py-2.5 rounded-lg border border-border bg-white text-text placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent transition disabled:bg-slate-100 disabled:opacity-60"
            />
          </div>

          <button
            type="submit"
            disabled={busy || already}
            className="w-full bg-primary-600 hover:bg-primary-700 text-white font-medium px-4 py-2.5 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
          >
            {busy ? "Signing in..." : "Sign in"}
          </button>

          {error && (
            <p className="text-sm text-danger font-medium">{error}</p>
          )}
        </form>
      </div>
    </div>
  );
}
