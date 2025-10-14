import { useEffect, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { auth } from "../auth";

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

export default function Signup() {
  const nav = useNavigate();
  const [role, setRole] = useState("patient");
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  // Already logged in? Go straight to dashboard.
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

    if (password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }

    setBusy(true);
    try {
      const res = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email.trim(),
          password,
          role,
          displayName: displayName || null,
        }),
      });
      const data = await jsonOrThrow(res, "Signup failed");
      auth.save(data); // stores token + role
      nav(role === "doctor" ? "/doctor" : "/patient", { replace: true });
    } catch (err) {
      setError(err.message || "Signup failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main style={{ fontFamily: "system-ui", padding: 24, maxWidth: 480 }}>
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
          }}
        >
          ← Home
        </button>
        <Link to="/login/patient">Login</Link>
      </div>

      <h1>Create an account</h1>

      <form onSubmit={onSubmit}>
        <label>
          Role
          <br />
          <select
            value={role}
            onChange={(e) => setRole(e.target.value)}
            style={{ width: "100%", padding: 8 }}
            disabled={busy}
          >
            <option value="patient">Patient</option>
            <option value="doctor">Doctor</option>
          </select>
        </label>
        <br />
        <br />

        <label>
          Display name (optional)
          <br />
          <input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            style={{ width: "100%", padding: 8 }}
            disabled={busy}
          />
        </label>
        <br />
        <br />

        <label>
          Email
          <br />
          <input
            type="email"
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
            autoComplete="new-password"
            style={{ width: "100%", padding: 8 }}
            disabled={busy}
          />
        </label>
        <br />
        <br />

        <button type="submit" style={{ padding: "8px 12px" }} disabled={busy}>
          {busy ? "Creating..." : "Sign up"}
        </button>
        {error && <p style={{ color: "tomato" }}>{error}</p>}
      </form>
    </main>
  );
}
