import { useEffect, useState, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { auth } from "../auth";
import Markdown from "../components/Markdown";

export default function PatientHome() {
  const { t, i18n } = useTranslation();
  const lang = i18n.resolvedLanguage?.startsWith("es") ? "es" : "en";
  const token = auth.token();
  const authHeader = { Authorization: `Bearer ${token}` };

  const [profile, setProfile] = useState(null);

  const [sessionId, setSessionId] = useState(null);
  const [messages, setMessages] = useState([]);

  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [aiError, setAiError] = useState(null);

  const [sessions, setSessions] = useState([]);
  const [sessionsBusy, setSessionsBusy] = useState(false);
  const [pickId, setPickId] = useState("");

  const messagesEndRef = useRef(null);

  const LS_KEY = "patient_active_session_id";

  function fmt(dt) {
    try { return new Date(dt).toLocaleString(lang === "es" ? "es-ES" : "en-US"); } catch { return dt; }
  }

  async function jsonOrThrow(res, fallbackMsg = t("errors.requestFailed")) {
    let data = null;
    try { data = await res.json(); } catch {
      // Use the caller's fallback when the response has no JSON body.
    }
    if (!res.ok) throw new Error((data && data.error) || fallbackMsg);
    return data;
  }

  async function loadMessages(sid) {
    const res = await fetch(`/api/patient/chat/${sid}/messages`, { headers: authHeader });
    const msgs = await jsonOrThrow(res, t("errors.couldNotLoadMessages"));
    setMessages(msgs);
  }

  function applySession(id) {
    setSessionId(id);
    setAiError(null);
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
      const list = await jsonOrThrow(res, t("errors.couldNotLoadSessions"));
      setSessions(list || []);
      if (pickId && !list.some((s) => String(s.id) === String(pickId))) setPickId("");
    } catch {
      // Keeping the last known session list is less disruptive than clearing it.
    } finally { setSessionsBusy(false); }
  }

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
        const { id } = await jsonOrThrow(res, t("errors.couldNotCheckActive"));
        if (id && id !== sessionId) applySession(id);
        if (!id && cached) localStorage.removeItem(LS_KEY);
      } catch {
        // Leave the UI usable even if the active-session lookup is unavailable.
      }
      refreshSessionsList();
    })();
  }, [token]);

  useEffect(() => { refreshSessionsList(); }, [sessionId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function startNewSession() {
    setBusy(true);
    setAiError(null);
    try {
      const res = await fetch("/api/patient/chat/start", { method: "POST", headers: authHeader });
      const s = await jsonOrThrow(res, t("errors.couldNotStartSession"));
      applySession(s.id);
      try {
        const aiRes = await fetch(`/api/ai/patient/chat/${s.id}/reply`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeader },
          body: JSON.stringify({ kickoff: true, lang }),
        });
        const aiMsg = await jsonOrThrow(aiRes, t("errors.aiKickoffFailed"));
        setMessages((prev) => [...prev, aiMsg]);
      } catch (e) {
        console.error("kickoff failed:", e);
        setAiError(t("errors.aiBannerStart"));
      }
    } catch (e) { alert(e.message || t("errors.failedToStartSession")); }
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
        t("errors.couldNotEndSession")
      );
      applySession(null);
      await refreshSessionsList();
    } catch (e) { alert(e.message || t("errors.failedToEndSession")); }
    finally { setBusy(false); }
  }

  async function resumePicked() {
    if (!pickId) return;
    setBusy(true);
    try {
      const sid = Number(pickId);
      const res = await fetch(`/api/patient/chat/${sid}/resume`, { method: "POST", headers: authHeader });
      const s = await jsonOrThrow(res, t("errors.couldNotResumeSession"));
      applySession(s.id);
      setPickId("");
    } catch (e) { alert(e.message || t("errors.resumeFailed")); }
    finally { setBusy(false); }
  }

  async function sendMessage(e) {
    e.preventDefault();
    if (!sessionId) { alert(t("errors.startSessionFirst")); return; }
    if (!text.trim()) return;
    setBusy(true);
    setAiError(null);
    try {
      const res = await fetch(`/api/patient/chat/${sessionId}/message`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeader },
        body: JSON.stringify({ content: text }),
      });
      const m = await jsonOrThrow(res, t("errors.couldNotSendMessage"));
      setMessages((prev) => [...prev, m]);
      try {
        const aiRes = await fetch(`/api/ai/patient/chat/${sessionId}/reply`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeader },
          body: JSON.stringify({ userText: text, lang }),
        });
        const ai = await jsonOrThrow(aiRes, t("errors.aiReplyFailed"));
        setMessages((prev) => [...prev, ai]);
        if (ai.auto_end) {
          applySession(null);
          await refreshSessionsList();
        }
      } catch (e) {
        console.error(e);
        setAiError(t("errors.aiBannerReply"));
      }
      setText("");
    } catch (e2) { alert(e2.message || t("errors.sendFailed")); }
    finally { setBusy(false); }
  }

  const previousSessions = useMemo(() => {
    return (sessions || []).filter((s) => s.id !== sessionId);
  }, [sessions, sessionId]);

  const sessionLabel = useMemo(() => {
    const sorted = [...(sessions || [])].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    const map = {};
    sorted.forEach((s, i) => { map[s.id] = i + 1; });
    return (id) => map[id] ?? id;
  }, [sessions]);

  /* ─── INTAKE FORM ─── */
  const needsIntake = !profile || ((!profile.full_name || !profile.date_of_birth || !profile.sex) && !sessionId);
  if (needsIntake) {
    return (
      <div className="max-w-md mx-auto pt-8 sm:pt-16">
        <div className="text-center mb-8">
          <div className="w-14 h-14 mx-auto mb-5 rounded-2xl bg-primary-100 text-primary-700 flex items-center justify-center shadow-sm">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>
            </svg>
          </div>
          <h1 className="font-display text-2xl font-bold text-ink tracking-tight mb-2">{t("patient.intakeTitle")}</h1>
          <p className="text-sm text-ink-muted">{t("patient.intakeSubtitle")}</p>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-border p-7">
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
                  t("errors.couldNotSaveIntake")
                );
                // Keep local profile in sync so ending a session later
                // doesn't bounce back to this intake form
                setProfile((p) => ({
                  ...(p || {}),
                  full_name: body.fullName,
                  date_of_birth: body.dateOfBirth,
                  sex: body.sex,
                }));
                await startNewSession();
              } catch (e) { alert(e.message || t("errors.failedToStart")); }
              finally { setBusy(false); }
            }}
            className="space-y-5"
          >
            <div>
              <label className="block text-sm font-medium text-ink mb-2">{t("patient.fullName")}</label>
              <input
                name="fullName"
                required
                defaultValue={profile?.full_name || ""}
                disabled={busy}
                className="w-full px-4 py-3 rounded-xl border border-border bg-canvas/50 text-ink placeholder:text-ink-faint focus:ring-2 focus:ring-primary-400 focus:border-primary-400 transition disabled:opacity-50"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-ink mb-2">{t("patient.dateOfBirth")}</label>
              <input
                type="date"
                name="dateOfBirth"
                required
                defaultValue={profile?.date_of_birth ? profile.date_of_birth.slice(0, 10) : ""}
                disabled={busy}
                className="w-full px-4 py-3 rounded-xl border border-border bg-canvas/50 text-ink placeholder:text-ink-faint focus:ring-2 focus:ring-primary-400 focus:border-primary-400 transition disabled:opacity-50"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-ink mb-2">{t("patient.sex")}</label>
              <select
                name="sex"
                required
                defaultValue={profile?.sex || "male"}
                disabled={busy}
                className="w-full px-4 py-3 rounded-xl border border-border bg-canvas/50 text-ink focus:ring-2 focus:ring-primary-400 focus:border-primary-400 transition disabled:opacity-50"
              >
                <option value="male">{t("common.sex.male")}</option>
                <option value="female">{t("common.sex.female")}</option>
                <option value="intersex">{t("common.sex.intersex")}</option>
                <option value="unknown">{t("common.sex.other")}</option>
                <option value="prefer_not_to_say">{t("common.sex.prefer_not_to_say")}</option>
              </select>
            </div>

            <button
              type="submit"
              disabled={busy}
              className="w-full bg-primary-600 hover:bg-primary-700 text-white font-semibold px-4 py-3 rounded-full transition-all shadow-sm hover:shadow-md disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
            >
              {busy ? t("patient.starting") : t("patient.begin")}
            </button>
          </form>
        </div>
      </div>
    );
  }

  /* ─── CHAT VIEW ─── */
  return (
    <div className="max-w-3xl mx-auto flex flex-col h-[calc(100vh-7rem)]">
      {/* Session bar */}
      <div className="flex flex-wrap items-center gap-2.5 mb-4 bg-white rounded-2xl border border-border p-3 shadow-sm">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-success animate-pulse" />
          <span className="text-sm font-semibold text-ink font-display">
            {t("patient.session", { n: sessionId ? sessionLabel(sessionId) : "\u2014" })}
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            onClick={endSession}
            disabled={busy || !sessionId}
            className="text-xs font-medium text-danger bg-red-50 hover:bg-red-100 px-3 py-1.5 rounded-full transition disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
          >
            {t("patient.end")}
          </button>
          <button
            onClick={startNewSession}
            disabled={busy}
            className="text-xs font-medium text-primary-700 bg-primary-50 hover:bg-primary-100 px-3 py-1.5 rounded-full transition disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
          >
            {t("patient.newSession")}
          </button>
        </div>

        <div className="flex items-center gap-1.5 ml-auto">
          <select
            value={pickId}
            onChange={(e) => setPickId(e.target.value)}
            disabled={sessionsBusy || busy || previousSessions.length === 0}
            className="min-w-[200px] px-3 py-1.5 rounded-full border border-border text-xs bg-canvas/50 text-ink focus:ring-2 focus:ring-primary-400 transition disabled:opacity-40"
          >
            <option value="">
              {sessionsBusy ? t("common.loading") : previousSessions.length === 0 ? t("patient.noPreviousSessions") : t("patient.previousSessions")}
            </option>
            {previousSessions.map((s) => (
              <option key={s.id} value={s.id}>
                {t("patient.sessionOption", { n: sessionLabel(s.id), status: t(`common.status.${s.status}`, s.status), date: fmt(s.created_at) })}
              </option>
            ))}
          </select>
          <button
            onClick={resumePicked}
            disabled={!pickId || busy}
            className="text-xs font-medium text-ink-muted border border-border hover:border-primary-400 hover:text-primary-700 px-3 py-1.5 rounded-full transition disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
          >
            {t("patient.resume")}
          </button>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 bg-white rounded-2xl border border-border shadow-sm overflow-y-auto p-5 space-y-4 min-h-0">
        {messages.map((m) => (
          <div
            key={m.id}
            className={`flex gap-3 ${m.sender === "patient" ? "justify-end" : "justify-start"}`}
          >
            {m.sender !== "patient" && (
              <div className="w-8 h-8 rounded-full bg-primary-100 text-primary-700 flex items-center justify-center text-xs font-bold shrink-0 mt-1 shadow-sm">
                {t("patient.avatarAI")}
              </div>
            )}
            <div className={`max-w-[75%] ${
              m.sender === "patient"
                ? "bg-ink text-white rounded-2xl rounded-br-md px-4 py-3"
                : "bg-canvas rounded-2xl rounded-bl-md px-4 py-3"
            }`}>
              {m.sender === "patient" ? (
                <p className="text-sm leading-relaxed">{m.content}</p>
              ) : (
                <Markdown text={m.content} />
              )}
              <p className={`text-[11px] mt-1.5 ${m.sender === "patient" ? "text-white/50" : "text-ink-faint"}`}>
                {fmt(m.created_at)}
              </p>
            </div>
            {m.sender === "patient" && (
              <div className="w-8 h-8 rounded-full bg-primary-600 text-white flex items-center justify-center text-xs font-bold shrink-0 mt-1 shadow-sm">
                {t("patient.avatarYou")}
              </div>
            )}
          </div>
        ))}
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full min-h-[280px] text-ink-faint">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="mb-3 opacity-40">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            <p className="text-sm">{t("patient.noMessages")}</p>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* AI error banner */}
      {aiError && (
        <div className="mt-3 flex items-center gap-2 px-4 py-2.5 bg-red-50 border border-red-200/60 rounded-xl">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-danger shrink-0"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          <p className="text-sm text-danger">{aiError}</p>
        </div>
      )}

      {/* Input */}
      <form onSubmit={sendMessage} className="mt-3 flex gap-2.5">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={sessionId ? t("patient.typeMessage") : t("patient.startOrResume")}
          disabled={busy || !sessionId}
          className="flex-1 px-5 py-3.5 rounded-full border border-border bg-white text-ink placeholder:text-ink-faint focus:ring-2 focus:ring-primary-400 focus:border-primary-400 transition shadow-sm disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={busy || !sessionId}
          className="bg-primary-600 hover:bg-primary-700 text-white font-semibold px-6 py-3.5 rounded-full transition-all shadow-sm hover:shadow-md disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
        >
          {busy ? (
            <svg className="w-5 h-5 animate-spin" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25"/><path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="3" strokeLinecap="round" className="opacity-75"/></svg>
          ) : (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
            </svg>
          )}
        </button>
      </form>
    </div>
  );
}
