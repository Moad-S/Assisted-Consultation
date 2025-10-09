import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { auth } from "../auth"; // the helper that saves token in localStorage

export default function Signup() {
  const nav = useNavigate();
  const [role, setRole] = useState("patient");
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  async function onSubmit(e) {
    e.preventDefault();
    setError("");
    try {
      const res = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, role, displayName }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Signup failed");
      const data = await res.json();
      auth.save(data); // stores token + role
      nav(role === "doctor" ? "/doctor" : "/patient");
    } catch (err) {
      setError(err.message);
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
          Sign up
        </button>
        {error && <p style={{ color: "tomato" }}>{error}</p>}
      </form>
    </main>
  );
}
