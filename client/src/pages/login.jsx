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
  const { who } = useParams(); // 'patient' | 'doctor'
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
    // When this page is rerendered; the form becomes usable
    nav(`/login/${role}`, { replace: true });
  }

  return (
    <main style={{ fontFamily: "system-ui", padding: 24, maxWidth: 420 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
        <button
          type="button"
          onClick={() => nav("/")}
          style={{
            padding: "6px 10px",
            borderRadius: 8,
            border: "1px solid #444",
            background: "#222",
            color: "#fff",
            cursor: "pointer",
          }}
        >
          ← Home
        </button>
        <span>
          <Link to="/login/patient">Patient</Link> ·{" "}
          <Link to="/login/doctor">Doctor</Link> ·{" "}
          <Link to="/signup">Create account</Link>
        </span>
      </div>

      <h1>Login – {titleCase(role)}</h1>

      {already && (
        <div
          style={{
            margin: "8px 0 16px",
            padding: "10px 12px",
            border: "1px solid #555",
            borderRadius: 8,
            background: "#1f1f1f",
          }}
        >
          You’re currently signed in as <strong>{currentRole}</strong>.{" "}
          <button
            onClick={signOutAndStay}
            style={{
              marginLeft: 8,
              border: "1px solid #444",
              background: "#222",
              color: "#fff",
              padding: "4px 8px",
              borderRadius: 8,
              cursor: "pointer",
            }}
          >
            Sign out to switch
          </button>
        </div>
      )}

      <form onSubmit={onSubmit}>
        <label>
          Email
          <br />
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="username"
            style={{ width: "100%", padding: 8 }}
            disabled={busy || already}
          />
        </label>
        <br />
        <br />
        <label>
          Password
          <br />
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="current-password"
            style={{ width: "100%", padding: 8 }}
            disabled={busy || already}
          />
        </label>
        <br />
        <br />
        <button type="submit" style={{ padding: "8px 12px" }} disabled={busy || already}>
          {busy ? "Signing in..." : "Sign in"}
        </button>
        {error && <p style={{ color: "tomato" }}>{error}</p>}
      </form>
    </main>
  );
}
