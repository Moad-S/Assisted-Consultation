// client/src/pages/patienthome.jsx
import { useEffect, useState, useMemo } from "react";
import { auth } from "../auth";

export default function PatientHome() {
  const token = auth.token();
  const authHeader = { Authorization: `Bearer ${token}` };

  const [profile, setProfile] = useState(null);

  const [sessionId, setSessionId] = useState(null);
  const [messages, setMessages] = useState([]);

  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  // sessions list for the dropdown
  const [sessions, setSessions] = useState([]);
  const [sessionsBusy, setSessionsBusy] = useState(false);
  const [pickId, setPickId] = useState(""); // selected session id from dropdown

  const LS_KEY = "patient_active_session_id";

  function fmt(dt) {
    try {
      return new Date(dt).toLocaleString();
    } catch {
      return dt;
    }
  }

  async function jsonOrThrow(res, fallbackMsg = "Request failed") {
    let data = null;
    try {
      data = await res.json();
    } catch {}
    if (!res.ok) throw new Error((data && data.error) || fallbackMsg);
    return data;
  }

  // ------------------------- load helpers ------------------------------------

  async function loadMessages(sid) {
    const res = await fetch(`/api/patient/chat/${sid}/messages`, {
      headers: authHeader,
    });
    const msgs = await jsonOrThrow(res, "Could not load messages");
    setMessages(msgs);
  }

  function applySession(id) {
    setSessionId(id);
    if (id) {
      localStorage.setItem(LS_KEY, String(id));
      loadMessages(id).catch(() => {});
    } else {
      localStorage.removeItem(LS_KEY);
      setMessages([]);
    }
  }

  async function refreshSessionsList() {
    setSessionsBusy(true);
    try {
      const res = await fetch(`/api/patient/chat/history?limit=20`, {
        headers: authHeader,
      });
      const list = await jsonOrThrow(res, "Could not load sessions");
      setSessions(list || []);
      // if selected in dropdown no longer valid, reset
      if (pickId && !list.some((s) => String(s.id) === String(pickId))) {
        setPickId("");
      }
    } catch {
      // ignore
    } finally {
      setSessionsBusy(false);
    }
  }

  // ------------------------- initial loads -----------------------------------

  // Load profile
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/patient/me", { headers: authHeader });
        const data = await res.json();
        setProfile(data || {});
      } catch {
        setProfile({});
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // On mount/refresh, restore active session and load the sessions list
  useEffect(() => {
    (async () => {
      // try cached
      const cached = localStorage.getItem(LS_KEY);
      if (cached && !sessionId) {
        const sid = Number(cached);
        if (sid > 0) {
          setSessionId(sid);
          loadMessages(sid).catch(() => {});
        }
      }
      // authoritative
      try {
        const res = await fetch("/api/patient/chat/active", {
          headers: authHeader,
        });
        const { id } = await jsonOrThrow(res, "Could not check active session");
        if (id && id !== sessionId) applySession(id);
        if (!id && cached) localStorage.removeItem(LS_KEY);
      } catch {}
      // load list
      refreshSessionsList();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // Keep sessions list relatively fresh whenever the active session changes
  useEffect(() => {
    refreshSessionsList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  // ------------------------- actions -----------------------------------------

  async function startNewSession() {
    setBusy(true);
    try {
      const res = await fetch("/api/patient/chat/start", {
        method: "POST",
        headers: authHeader,
      });
      const s = await jsonOrThrow(res, "Could not start session");
      applySession(s.id);
    } catch (e) {
      alert(e.message || "Failed to start session");
    } finally {
      setBusy(false);
    }
  }

  async function endSession() {
    if (!sessionId) return;
    setBusy(true);
    try {
      await jsonOrThrow(
        await fetch(`/api/patient/chat/end`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeader },
          body: JSON.stringify({ sessionId }),
        }),
        "Could not end session"
      );
      applySession(null);
      await refreshSessionsList();
    } catch (e) {
      alert(e.message || "Failed to end session");
    } finally {
      setBusy(false);
    }
  }

  async function resumePicked() {
    if (!pickId) return;
    setBusy(true);
    try {
      const sid = Number(pickId);
      const res = await fetch(`/api/patient/chat/${sid}/resume`, {
        method: "POST",
        headers: authHeader,
      });
      const s = await jsonOrThrow(res, "Could not resume session");
      applySession(s.id);
      setPickId("");
    } catch (e) {
      alert(e.message || "Resume failed");
    } finally {
      setBusy(false);
    }
  }

  async function sendMessage(e) {
    e.preventDefault();
    if (!sessionId) {
      alert("Please start a session first.");
      return;
    }
    if (!text.trim()) return;

    setBusy(true);
    try {
      // Save patient message
      const res = await fetch(`/api/patient/chat/${sessionId}/message`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeader },
        body: JSON.stringify({ content: text }),
      });
      const m = await jsonOrThrow(res, "Could not send message");
      setMessages((prev) => [...prev, m]);

      // Ask AI to reply
      try {
        const aiRes = await fetch(`/api/ai/patient/chat/${sessionId}/reply`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeader },
          body: JSON.stringify({ userText: text }),
        });
        const ai = await jsonOrThrow(aiRes, "AI reply failed");
        setMessages((prev) => [...prev, ai]);
      } catch (e) {
        // If AI fails, still keep user's message; optionally surface a toast
        console.error(e);
      }

      setText("");
    } catch (e2) {
      alert(e2.message || "Send failed");
    } finally {
      setBusy(false);
    }
  }

  // ------------------------- derived data ------------------------------------

  const previousSessions = useMemo(() => {
    // show ended sessions and any not-equal active ones
    return (sessions || []).filter((s) => s.id !== sessionId);
  }, [sessions, sessionId]);

  // ------------------------- render ------------------------------------------

  // Intake first if no profile yet AND no active session
  if (!profile || (!profile.full_name && !sessionId)) {
    return (
      <main style={{ fontFamily: "system-ui", padding: 24, maxWidth: 520 }}>
        <h1>Patient Intake</h1>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            try {
              const form = new FormData(e.currentTarget);
              const body = {
                fullName: form.get("fullName"),
                dateOfBirth: form.get("dateOfBirth"),
                sex: form.get("sex"),
              };

              await jsonOrThrow(
                await fetch("/api/patient/profile", {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                    ...authHeader,
                  },
                  body: JSON.stringify(body),
                }),
                "Could not save intake"
              );

              await startNewSession();
            } catch (e) {
              alert(e.message || "Failed to start");
            } finally {
              setBusy(false);
            }
          }}
        >
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

  // Chat UI
  return (
    <main style={{ fontFamily: "system-ui", padding: 24, maxWidth: 900 }}>
      <h1>Patient Chat</h1>

      {/* controls row */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 12,
          alignItems: "center",
          marginBottom: 12,
        }}
      >
        <span style={{ opacity: 0.85 }}>
          Current session: <strong>#{sessionId ?? "—"}</strong>
        </span>

        <button onClick={endSession} disabled={busy || !sessionId}>
          End Session
        </button>

        <button onClick={startNewSession} disabled={busy}>
          Start Another Session
        </button>

        {/* Previous sessions dropdown */}
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <select
            value={pickId}
            onChange={(e) => setPickId(e.target.value)}
            disabled={sessionsBusy || busy || previousSessions.length === 0}
            style={{ minWidth: 260, padding: 6 }}
          >
            <option value="">
              {sessionsBusy
                ? "Loading sessions…"
                : previousSessions.length === 0
                ? "No previous sessions"
                : "Select a previous session…"}
            </option>
            {previousSessions.map((s) => (
              <option key={s.id} value={s.id}>
                #{s.id} · {s.status} · {fmt(s.created_at)}
              </option>
            ))}
          </select>
          <button onClick={resumePicked} disabled={!pickId || busy}>
            Resume
          </button>
          <button onClick={refreshSessionsList} disabled={sessionsBusy || busy}>
            Refresh
          </button>
        </div>
      </div>

      <div
        style={{
          border: "1px solid #444",
          borderRadius: 8,
          padding: 12,
          minHeight: 280,
        }}
      >
        {messages.map((m) => (
          <div key={m.id} style={{ margin: "6px 0" }}>
            <strong>{m.sender}:</strong> {m.content}
            <small style={{ opacity: 0.6, marginLeft: 8 }}>
              {fmt(m.created_at)}
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
            sessionId ? "Type your message..." : "Start or resume a session"
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
