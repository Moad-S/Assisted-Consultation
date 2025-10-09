// client/src/pages/Login.jsx
import { useState } from "react";
import { useNavigate, useParams, Link } from "react-router-dom";
import { auth } from "../auth";

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

  async function onSubmit(e) {
    e.preventDefault();
    setError("");
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, role }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Login failed");
      const data = await res.json();
      auth.save(data);
      nav(role === "doctor" ? "/doctor" : "/patient");
    } catch (err) {
      setError(err.message);
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
          <Link to="/login/doctor">Doctor</Link>
        </span>
      </div>

      <h1>Login – {role[0].toUpperCase() + role.slice(1)}</h1>

      <form onSubmit={onSubmit}>
        <label>
          Email
          <br />
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            style={{ width: "100%", padding: 8 }}
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
            style={{ width: "100%", padding: 8 }}
          />
        </label>
        <br />
        <br />
        <button type="submit" style={{ padding: "8px 12px" }}>
          Sign in
        </button>
        {error && <p style={{ color: "tomato" }}>{error}</p>}
      </form>
    </main>
  );
}
