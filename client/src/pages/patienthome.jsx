// client/src/pages/patienthome.jsx
import { useEffect, useState, useMemo } from "react";
import { auth } from "../auth";
import Markdown from "../components/Markdown";

export default function PatientHome() {
  const token = auth.token();
  const authHeader = { Authorization: `Bearer ${token}` };

  const [profile, setProfile] = useState(null);

  const [sessionId, setSessionId] = useState(null);
  const [messages, setMessages] = useState([]);

  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  const [sessions, setSessions] = useState([]);
  const [sessionsBusy, setSessionsBusy] = useState(false);
  const [pickId, setPickId] = useState("");

  const LS_KEY = "patient_active_session_id";

  function fmt(dt) {
    try { return new Date(dt).toLocaleString(); } catch { return dt; }
  }

  async function jsonOrThrow(res, fallbackMsg = "Request failed") {
    let data = null;
    try { data = await res.json(); } catch {}
    if (!res.ok) throw new Error((data && data.error) || fallbackMsg);
    return data;
  }

  // ------------------------- load helpers ------------------------------------

  async function loadMessages(sid) {
    const res = await fetch(`/api/patient/chat/${sid}/messages`, { headers: authHeader });
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
      const res = await fetch(`/api/patient/chat/history?limit=20`, { headers: authHeader });
      const list = await jsonOrThrow(res, "Could not load sessions");
      setSessions(list || []);
      if (pickId && !list.some((s) => String(s.id) === String(pickId))) setPickId("");
    } catch {} finally { setSessionsBusy(false); }
  }

  // ------------------------- initial loads -----------------------------------

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/patient/me", { headers: authHeader });
        const data = await res.json();
        setProfile(data || {});
      } catch { setProfile({}); }
    })();
  }, [token]);

  useEffect(() => {
    (async () => {
      const cached = localStorage.getItem(LS_KEY);
      if (cached && !sessionId) {
        const sid = Number(cached);
        if (sid > 0) { setSessionId(sid); loadMessages(sid).catch(() => {}); }
      }
      try {
        const res = await fetch("/api/patient/chat/active", { headers: authHeader });
        const { id } = await jsonOrThrow(res, "Could not check active session");
        if (id && id !== sessionId) applySession(id);
        if (!id && cached) localStorage.removeItem(LS_KEY);
      } catch {}
      refreshSessionsList();
    })();
  }, [token]);

  useEffect(() => { refreshSessionsList(); }, [sessionId]);

  // ------------------------- actions -----------------------------------------

  async function startNewSession() {
    setBusy(true);
    try {
      const res = await fetch("/api/patient/chat/start", { method: "POST", headers: authHeader });
      const s = await jsonOrThrow(res, "Could not start session");
      applySession(s.id);
      try {
        const aiRes = await fetch(`/api/ai/patient/chat/${s.id}/reply`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeader },
          body: JSON.stringify({ kickoff: true }),
        });
        const aiMsg = await jsonOrThrow(aiRes, "AI kickoff failed");
        setMessages((prev) => [...prev, aiMsg]);
      } catch (e) { console.error("kickoff failed:", e); }
    } catch (e) { alert(e.message || "Failed to start session"); }
    finally { setBusy(false); }
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
    } catch (e) { alert(e.message || "Failed to end session"); }
    finally { setBusy(false); }
  }

  async function resumePicked() {
    if (!pickId) return;
    setBusy(true);
    try {
      const sid = Number(pickId);
      const res = await fetch(`/api/patient/chat/${sid}/resume`, { method: "POST", headers: authHeader });
      const s = await jsonOrThrow(res, "Could not resume session");
      applySession(s.id);
      setPickId("");
    } catch (e) { alert(e.message || "Resume failed"); }
    finally { setBusy(false); }
  }

  async function sendMessage(e) {
    e.preventDefault();
    if (!sessionId) { alert("Please start a session first."); return; }
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
      try {
        const aiRes = await fetch(`/api/ai/patient/chat/${sessionId}/reply`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeader },
          body: JSON.stringify({ userText: text }),
        });
        const ai = await jsonOrThrow(aiRes, "AI reply failed");
        setMessages((prev) => [...prev, ai]);
      } catch (e) { console.error(e); }
      setText("");
    } catch (e2) { alert(e2.message || "Send failed"); }
    finally { setBusy(false); }
  }

  // ------------------------- derived data ------------------------------------

  const previousSessions = useMemo(() => {
    return (sessions || []).filter((s) => s.id !== sessionId);
  }, [sessions, sessionId]);

  // Map DB session IDs → per-patient display numbers (1, 2, 3...)
  const sessionLabel = useMemo(() => {
    const sorted = [...(sessions || [])].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    const map = {};
    sorted.forEach((s, i) => { map[s.id] = i + 1; });
    return (id) => map[id] ?? id;
  }, [sessions]);

  // ------------------------- render: Intake ----------------------------------

  if (!profile || (!profile.full_name && !sessionId)) {
    return (
      <div className="max-w-lg mx-auto">
        <h1 className="text-2xl font-bold text-text mb-2">Patient Intake</h1>
        <p className="text-text-muted mb-6">Please fill in your details to begin your consultation.</p>

        <div className="bg-white border border-border rounded-xl shadow-sm p-6">
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
                    headers: { "Content-Type": "application/json", ...authHeader },
                    body: JSON.stringify(body),
                  }),
                  "Could not save intake"
                );
                await startNewSession();
              } catch (e) { alert(e.message || "Failed to start"); }
              finally { setBusy(false); }
            }}
            className="space-y-5"
          >
            <div>
              <label className="block text-sm font-medium text-text-muted mb-1.5">Full name</label>
              <input
                name="fullName"
                required
                disabled={busy}
                className="w-full px-3 py-2.5 rounded-lg border border-border bg-white text-text focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent transition disabled:bg-slate-100 disabled:opacity-60"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-text-muted mb-1.5">Date of birth</label>
              <input
                type="date"
                name="dateOfBirth"
                required
                disabled={busy}
                className="w-full px-3 py-2.5 rounded-lg border border-border bg-white text-text focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent transition disabled:bg-slate-100 disabled:opacity-60"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-text-muted mb-1.5">Sex</label>
              <select
                name="sex"
                required
                disabled={busy}
                className="w-full px-3 py-2.5 rounded-lg border border-border bg-white text-text focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent transition disabled:bg-slate-100 disabled:opacity-60"
              >
                <option value="male">Male</option>
                <option value="female">Female</option>
                <option value="intersex">Intersex</option>
                <option value="unknown">Other</option>
                <option value="prefer_not_to_say">Prefer not to say</option>
              </select>
            </div>

            <button
              type="submit"
              disabled={busy}
              className="w-full bg-primary-600 hover:bg-primary-700 text-white font-medium px-4 py-2.5 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
            >
              {busy ? "Starting..." : "Start session"}
            </button>
          </form>
        </div>
      </div>
    );
  }

  // ------------------------- render: Chat ------------------------------------

  return (
    <div className="max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold text-text mb-4">Patient Chat</h1>

      {/* Controls bar */}
      <div className="flex flex-wrap items-center gap-3 mb-4 bg-white border border-border rounded-xl p-4 shadow-sm">
        <span className="text-sm text-text-muted">
          Session: <strong className="text-primary-700">#{sessionId ? sessionLabel(sessionId) : "—"}</strong>
        </span>

        <button
          onClick={endSession}
          disabled={busy || !sessionId}
          className="text-sm bg-red-50 text-red-600 hover:bg-red-100 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
        >
          End Session
        </button>

        <button
          onClick={startNewSession}
          disabled={busy}
          className="text-sm bg-primary-600 hover:bg-primary-700 text-white px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
        >
          New Session
        </button>

        <div className="flex items-center gap-2 ml-auto">
          <select
            value={pickId}
            onChange={(e) => setPickId(e.target.value)}
            disabled={sessionsBusy || busy || previousSessions.length === 0}
            className="min-w-[240px] px-3 py-1.5 rounded-lg border border-border text-sm bg-white text-text focus:outline-none focus:ring-2 focus:ring-primary-500 transition disabled:opacity-60"
          >
            <option value="">
              {sessionsBusy ? "Loading sessions..." : previousSessions.length === 0 ? "No previous sessions" : "Select a previous session..."}
            </option>
            {previousSessions.map((s) => (
              <option key={s.id} value={s.id}>
                Session {sessionLabel(s.id)} - {s.status} - {fmt(s.created_at)}
              </option>
            ))}
          </select>
          <button
            onClick={resumePicked}
            disabled={!pickId || busy}
            className="text-sm border border-primary-300 text-primary-700 hover:bg-primary-50 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
          >
            Resume
          </button>
          <button
            onClick={refreshSessionsList}
            disabled={sessionsBusy || busy}
            className="text-sm text-text-muted hover:text-primary-600 px-2 py-1.5 rounded-lg transition-colors disabled:opacity-50 cursor-pointer"
          >
            Refresh
          </button>
        </div>
      </div>

      {/* Messages */}
      <div className="bg-white border border-border rounded-xl p-4 min-h-[350px] max-h-[60vh] overflow-y-auto shadow-sm space-y-4">
        {messages.map((m) => (
          <div
            key={m.id}
            className={`flex gap-3 ${m.sender === "patient" ? "justify-end" : "justify-start"}`}
          >
            {m.sender !== "patient" && (
              <div className="w-8 h-8 rounded-full bg-primary-100 text-primary-700 flex items-center justify-center text-xs font-bold shrink-0 mt-1">
                AI
              </div>
            )}
            <div className={`max-w-[80%] ${m.sender === "patient" ? "bg-primary-50 rounded-2xl rounded-tr-sm px-4 py-2.5" : ""}`}>
              {m.sender === "patient" ? (
                <p className="text-sm text-text">{m.content}</p>
              ) : (
                <Markdown text={m.content} />
              )}
              <p className="text-xs text-text-muted mt-1">{fmt(m.created_at)}</p>
            </div>
            {m.sender === "patient" && (
              <div className="w-8 h-8 rounded-full bg-teal-100 text-teal-700 flex items-center justify-center text-xs font-bold shrink-0 mt-1">
                You
              </div>
            )}
          </div>
        ))}
        {messages.length === 0 && (
          <div className="flex items-center justify-center h-[280px] text-text-muted">
            No messages yet. Start a session to begin.
          </div>
        )}
      </div>

      {/* Input */}
      <form onSubmit={sendMessage} className="mt-4 flex gap-3">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={sessionId ? "Type your message..." : "Start or resume a session"}
          disabled={busy || !sessionId}
          className="flex-1 px-4 py-2.5 rounded-lg border border-border bg-white text-text placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent transition disabled:bg-slate-100 disabled:opacity-60"
        />
        <button
          type="submit"
          disabled={busy || !sessionId}
          className="bg-primary-600 hover:bg-primary-700 text-white font-medium px-5 py-2.5 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
        >
          Send
        </button>
      </form>
    </div>
  );
}
