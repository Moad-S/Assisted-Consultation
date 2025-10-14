import { useEffect, useState } from "react";
import { useNavigate, useParams, Link } from "react-router-dom";
import { auth } from "../auth";

function titleCase(s) {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

async function jsonOrThrow(res, fallback = "Request failed") {
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* ignore parse error */
  }
  if (!res.ok) {
    throw new Error((data && data.error) || fallback);
  }
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

  // If already logged in, bounce to the right dashboard on first render
  useEffect(() => {
    if (auth.isLoggedIn()) {
      const r = auth.role();
      if (r === "patient") nav("/patient", { replace: true });
      else if (r === "doctor") nav("/doctor", { replace: true });
    }
  }, [nav]);

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
      auth.save(data); // persists token+role in localStorage
      nav(role === "doctor" ? "/doctor" : "/patient", { replace: true });
    } catch (err) {
      setError(err.message || "Login failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main style={{ fontFamily: "system-ui", padding: 24, maxWidth: 420 }}>
      {/* Home + toggle links */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          marginBottom: 12,
        }}
      >
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
            disabled={busy}
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
            disabled={busy}
          />
        </label>
        <br />
        <br />
        <button type="submit" style={{ padding: "8px 12px" }} disabled={busy}>
          {busy ? "Signing in..." : "Sign in"}
        </button>
        {error && <p style={{ color: "tomato" }}>{error}</p>}
      </form>
    </main>
  );
}
