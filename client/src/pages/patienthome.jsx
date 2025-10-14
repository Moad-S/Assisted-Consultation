import { useEffect, useState } from "react";
import { auth } from "../auth";

export default function PatientHome() {
  const token = auth.token();
  const [profile, setProfile] = useState(null);
  const [sessionId, setSessionId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  // ---- helpers --------------------------------------------------------------

  const authHeader = { Authorization: `Bearer ${token}` };

  async function jsonOrThrow(res, fallbackMsg = "Request failed") {
    let data = null;
    try {
      data = await res.json();
    } catch {
      /* ignore parse errors; we'll throw generic below */
    }
    if (!res.ok) {
      const msg = (data && data.error) || fallbackMsg;
      throw new Error(msg);
    }
    return data;
  }

  async function loadMessages(sid) {
    const res = await fetch(`/api/patient/chat/${sid}/messages`, {
      headers: authHeader,
    });
    const msgs = await jsonOrThrow(res, "Could not load messages");
    setMessages(msgs);
  }

  async function startNewSession() {
    setBusy(true);
    try {
      const res = await fetch("/api/patient/chat/start", {
        method: "POST",
        headers: authHeader,
      });
      const s = await jsonOrThrow(res, "Could not start session");
      setSessionId(s.id);
      await loadMessages(s.id);
    } catch (e) {
      alert(e.message || "Failed to start session");
    } finally {
      setBusy(false);
    }
  }

  // ---- initial profile load -------------------------------------------------

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/patient/me", { headers: authHeader });
        const data = await res.json(); // ok to be empty on first visit
        setProfile(data || {});
      } catch {
        setProfile({});
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // ---- actions --------------------------------------------------------------

  async function saveIntakeAndStart(e) {
    e.preventDefault();
    setBusy(true);
    try {
      const form = new FormData(e.currentTarget);
      const body = {
        fullName: form.get("fullName"),
        dateOfBirth: form.get("dateOfBirth"),
        sex: form.get("sex"),
      };

      // save intake
      let res = await fetch("/api/patient/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeader },
        body: JSON.stringify(body),
      });
      await jsonOrThrow(res, "Could not save intake");

      // start a session
      await startNewSession();
    } catch (e) {
      alert(e.message || "Failed to start");
    } finally {
      setBusy(false);
    }
  }

  async function sendMessage(e) {
    e.preventDefault();
    if (!sessionId) {
      alert("Please start a new session first.");
      return;
    }
    if (!text.trim()) return;

    setBusy(true);
    try {
      const res = await fetch(`/api/patient/chat/${sessionId}/message`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeader },
        body: JSON.stringify({ content: text }),
      });
      const m = await jsonOrThrow(res, "Could not send message");
      setMessages((prev) => [...prev, m]);
      setText("");
    } catch (e2) {
      alert(e2.message || "Send failed");
    } finally {
      setBusy(false);
    }
  }

  // ---- render ---------------------------------------------------------------

  // intake first (no profile full_name saved yet and no active session)
  if (!profile || (!profile.full_name && !sessionId)) {
    return (
      <main style={{ fontFamily: "system-ui", padding: 24, maxWidth: 520 }}>
        <h1>Patient Intake</h1>
        <form onSubmit={saveIntakeAndStart}>
          <label>
            Full name
            <br />
            <input
              name="fullName"
              required
              style={{ width: "100%", padding: 8 }}
              disabled={busy}
            />
          </label>
          <br />
          <br />
          <label>
            Date of birth
            <br />
            <input
              type="date"
              name="dateOfBirth"
              required
              style={{ width: "100%", padding: 8 }}
              disabled={busy}
            />
          </label>
          <br />
          <br />
          <label>
            Sex
            <br />
            <select
              name="sex"
              required
              style={{ width: "100%", padding: 8 }}
              disabled={busy}
            >
              <option value="male">Male</option>
              <option value="female">Female</option>
              <option value="nonbinary">Non-binary</option>
              <option value="other">Other</option>
              <option value="prefer_not_to_say">Prefer not to say</option>
            </select>
          </label>
          <br />
          <br />
          <button type="submit" style={{ padding: "8px 12px" }} disabled={busy}>
            {busy ? "Starting..." : "Start session"}
          </button>
        </form>
      </main>
    );
  }

  // chat UI
  return (
    <main style={{ fontFamily: "system-ui", padding: 24, maxWidth: 900 }}>
      <h1>Patient Chat</h1>
      {!sessionId && (
        <button onClick={startNewSession} disabled={busy}>
          {busy ? "Starting..." : "Start New Session"}
        </button>
      )}
      <div
        style={{
          border: "1px solid #444",
          borderRadius: 8,
          padding: 12,
          minHeight: 280,
          marginTop: 12,
        }}
      >
        {messages.map((m) => (
          <div key={m.id} style={{ margin: "6px 0" }}>
            <strong>{m.sender}:</strong> {m.content}
            <small style={{ opacity: 0.6, marginLeft: 8 }}>
              {new Date(m.created_at).toLocaleString()}
            </small>
          </div>
        ))}
        {messages.length === 0 && (
          <p style={{ opacity: 0.7 }}>No messages yet.</p>
        )}
      </div>
      <form
        onSubmit={sendMessage}
        style={{ marginTop: 12, display: "flex", gap: 8 }}
      >
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          style={{ flex: 1, padding: 8 }}
          placeholder={
            sessionId ? "Type your message..." : "Start a session first"
          }
          disabled={busy || !sessionId}
        />
        <button type="submit" disabled={busy || !sessionId}>
          Send
        </button>
      </form>
    </main>
  );
}
