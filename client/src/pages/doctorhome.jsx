// client/src/pages/doctorhome.jsx
import { useEffect, useState, useMemo } from "react";
import { auth } from "../auth";
import Markdown from "../components/Markdown";

export default function DoctorHome() {
  const token = auth.token();
  const authHeader = { Authorization: `Bearer ${token}` };

  const [patients, setPatients] = useState([]);
  const [selectedPatient, setSelectedPatient] = useState(null);

  const [sessions, setSessions] = useState([]);
  const [sessionsBusy, setSessionsBusy] = useState(false);

  const [selectedSessionId, setSelectedSessionId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [messagesBusy, setMessagesBusy] = useState(false);

  const [summary, setSummary] = useState(null);
  const [summaryBusy, setSummaryBusy] = useState(false);

  const [profile, setProfile] = useState(null);
  const [profileBusy, setProfileBusy] = useState(false);

  const [note, setNote] = useState("");
  const [noteBusy, setNoteBusy] = useState(false);
  const [noteMeta, setNoteMeta] = useState(null);

  // Which detail tab is active
  const [detailTab, setDetailTab] = useState("messages");

  useEffect(() => {
    (async () => {
      const res = await fetch("/api/doctor/patients", { headers: authHeader });
      const data = await res.json();
      setPatients(data || []);
    })();
  }, [token]);

  function fmtDate(dt) {
    try { return new Date(dt).toLocaleString(); } catch { return dt ?? ""; }
  }

  function ProfileRow({ label, value }) {
    if (
      value === null || value === undefined ||
      (typeof value === "string" && value.trim() === "") ||
      (Array.isArray(value) && value.length === 0)
    ) return null;

    return (
      <div className="mb-3">
        <div className="text-sm font-semibold text-text-muted mb-1">{label}</div>
        {Array.isArray(value) ? (
          <ul className="ml-4 space-y-0.5 text-sm text-text list-disc">
            {value.map((v, i) => (
              <li key={i} className="leading-relaxed">
                {typeof v === "string" ? v : JSON.stringify(v)}
              </li>
            ))}
          </ul>
        ) : typeof value === "string" ? (
          <div className="text-sm"><Markdown text={value} /></div>
        ) : (
          <pre className="text-xs font-mono bg-slate-50 p-2 rounded-md overflow-x-auto whitespace-pre-wrap break-words text-text">
            {JSON.stringify(value, null, 2)}
          </pre>
        )}
      </div>
    );
  }

  async function refreshProfile(pid) {
    if (!pid) return;
    setProfileBusy(true);
    try {
      const data = await fetch(`/api/doctor/patients/${pid}/profile`, { headers: authHeader }).then((r) => r.json());
      setProfile(data || null);
    } finally { setProfileBusy(false); }
  }

  async function openPatient(p) {
    setSelectedPatient(p);
    setSelectedSessionId(null);
    setMessages([]);
    setSummary(null);
    setProfile(null);
    setNote("");
    setNoteMeta(null);
    setDetailTab("messages");

    setSessionsBusy(true);
    setProfileBusy(true);
    try {
      const [sessionsResp, profileResp] = await Promise.all([
        fetch(`/api/doctor/patients/${p.user_id}/sessions`, { headers: authHeader }).then((r) => r.json()),
        fetch(`/api/doctor/patients/${p.user_id}/profile`, { headers: authHeader }).then((r) => r.json()),
      ]);
      setSessions(sessionsResp || []);
      setProfile(profileResp || null);
    } finally { setSessionsBusy(false); setProfileBusy(false); }
  }

  async function loadNote(sessionId) {
    setNote("");
    setNoteMeta(null);
    try {
      const n = await fetch(`/api/doctor/sessions/${sessionId}/note`, { headers: authHeader }).then(async (r) => {
        if (!r.ok) return null;
        return r.json();
      });
      if (n && n.note_md) { setNote(n.note_md); setNoteMeta({ updated_at: n.updated_at }); }
    } catch {}
  }

  async function saveNote() {
    if (!selectedSessionId || !note.trim()) return;
    setNoteBusy(true);
    try {
      const res = await fetch(`/api/doctor/sessions/${selectedSessionId}/note`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeader },
        body: JSON.stringify({ note_md: note }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed to save note");
      setNoteMeta({ updated_at: data.updated_at, extracted_profile_patch: data.extracted_profile_patch || null });
      await refreshProfile(selectedPatient?.user_id);
    } catch (e) { alert(e.message || "Save failed"); }
    finally { setNoteBusy(false); }
  }

  async function openSession(id) {
    setSelectedSessionId(id);
    setMessages([]);
    setSummary(null);
    setNote("");
    setNoteMeta(null);
    loadNote(id);
    setMessagesBusy(true);
    try {
      const msgs = await fetch(`/api/doctor/sessions/${id}/messages`, { headers: authHeader }).then((r) => r.json());
      setMessages(msgs || []);
    } finally { setMessagesBusy(false); }
    setSummaryBusy(true);
    try {
      const s = await fetch(`/api/doctor/sessions/${id}/summary`, { headers: authHeader }).then(async (r) => {
        if (!r.ok) return null;
        return r.json();
      });
      setSummary(s);
    } finally { setSummaryBusy(false); }
  }

  const aiProfile = useMemo(() => {
    const d = profile?.profile?.data;
    return d && typeof d === "object" ? d : null;
  }, [profile]);

  const medsValue = useMemo(() => {
    if (!aiProfile) return null;
    const v = aiProfile.medications;
    if (Array.isArray(v)) return v.length ? v : "Not documented";
    if (typeof v === "string") return v.trim() ? v : "Not documented";
    return v ? v : "Not documented";
  }, [aiProfile]);

  const rxValue = useMemo(() => {
    if (!aiProfile) return null;
    const v = aiProfile.doctor_prescriptions;
    if (Array.isArray(v)) return v.length ? v : "None documented";
    if (typeof v === "string") return v.trim() ? v : "None documented";
    return v ? v : "None documented";
  }, [aiProfile]);

  // ── Tab definitions ──
  const tabs = [
    { id: "messages", label: "Messages" },
    { id: "summary", label: "Summary" },
    { id: "notes", label: "Notes" },
    { id: "profile", label: "Profile" },
  ];

  // ── Render ──
  return (
    <div className="flex gap-5 -mx-4 sm:-mx-6 lg:-mx-8 px-4 sm:px-6 lg:px-8 h-[calc(100vh-7rem)]">

      {/* ════════════ LEFT SIDEBAR: Patients + Sessions ════════════ */}
      <aside className="w-72 shrink-0 flex flex-col gap-4 overflow-hidden">

        {/* Patients */}
        <div className="bg-white border border-border rounded-xl shadow-sm flex flex-col min-h-0 flex-1">
          <div className="px-4 pt-4 pb-2">
            <h2 className="text-base font-semibold text-text">Patients</h2>
          </div>
          <div className="flex-1 overflow-y-auto px-3 pb-3 space-y-1.5">
            {patients.map((p) => (
              <button
                key={p.user_id}
                onClick={() => openPatient(p)}
                className={`w-full text-left px-3 py-2.5 rounded-lg border transition-all cursor-pointer
                  ${selectedPatient?.user_id === p.user_id
                    ? "border-primary-500 bg-primary-50 ring-1 ring-primary-200"
                    : "border-transparent hover:bg-slate-50"
                  }`}
              >
                <div className="font-medium text-text text-sm">{p.name}</div>
                <div className="text-xs text-text-muted mt-0.5 truncate">{p.email}</div>
              </button>
            ))}
            {patients.length === 0 && (
              <p className="text-sm text-text-muted py-6 text-center">No patients yet.</p>
            )}
          </div>
        </div>

        {/* Sessions */}
        <div className="bg-white border border-border rounded-xl shadow-sm flex flex-col min-h-0 flex-1">
          <div className="px-4 pt-4 pb-2">
            <h2 className="text-base font-semibold text-text">
              Sessions
              {selectedPatient && <span className="text-text-muted font-normal text-sm ml-1.5">({selectedPatient.name})</span>}
            </h2>
          </div>
          <div className="flex-1 overflow-y-auto px-3 pb-3 space-y-1.5">
            {!selectedPatient ? (
              <p className="text-sm text-text-muted py-6 text-center">Select a patient</p>
            ) : sessionsBusy ? (
              <p className="text-sm text-text-muted py-6 text-center">Loading...</p>
            ) : sessions.length === 0 ? (
              <p className="text-sm text-text-muted py-6 text-center">No sessions</p>
            ) : (
              sessions.map((s) => (
                <button
                  key={s.id}
                  onClick={() => openSession(s.id)}
                  className={`w-full text-left px-3 py-2.5 rounded-lg border transition-all cursor-pointer
                    ${s.id === selectedSessionId
                      ? "border-primary-500 bg-primary-50 ring-1 ring-primary-200"
                      : "border-transparent hover:bg-slate-50"
                    }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-sm text-text">#{s.id}</span>
                    <span className="text-xs text-text-muted">{fmtDate(s.created_at)}</span>
                  </div>
                  <div className="flex items-center gap-1.5 mt-1.5">
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full
                      ${s.status === "active" ? "bg-green-100 text-green-800" : "bg-slate-100 text-slate-600"}`}>
                      {s.status}
                    </span>
                    {!!s.summary_at && (
                      <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 ml-auto">
                        summary
                      </span>
                    )}
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      </aside>

      {/* ════════════ RIGHT: Detail panel ════════════ */}
      <div className="flex-1 flex flex-col min-w-0 min-h-0">

        {/* Tab bar */}
        <div className="flex items-center gap-1 mb-4 bg-white border border-border rounded-xl shadow-sm p-1.5">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setDetailTab(t.id)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer
                ${detailTab === t.id
                  ? "bg-primary-600 text-white shadow-sm"
                  : "text-text-muted hover:text-text hover:bg-slate-50"
                }`}
            >
              {t.label}
              {t.id === "messages" && selectedSessionId ? ` (#${selectedSessionId})` : ""}
            </button>
          ))}

          {/* Session indicator */}
          {selectedPatient && (
            <span className="ml-auto text-sm text-text-muted pr-2">
              {selectedPatient.name}
              {selectedSessionId ? <> &middot; Session #{selectedSessionId}</> : ""}
            </span>
          )}
        </div>

        {/* Tab content */}
        <div className="flex-1 bg-white border border-border rounded-xl shadow-sm overflow-hidden flex flex-col min-h-0">

          {/* ── Messages tab ── */}
          {detailTab === "messages" && (
            <div className="flex-1 overflow-y-auto p-5 space-y-3">
              {!selectedSessionId ? (
                <EmptyState text="Select a patient and session to view the chat log." />
              ) : messagesBusy ? (
                <EmptyState text="Loading messages..." />
              ) : messages.length === 0 ? (
                <EmptyState text="No messages in this session." />
              ) : (
                messages.map((m) => (
                  <div key={m.id} className="py-2.5 border-b border-border/40 last:border-b-0">
                    <div className="flex items-start gap-3">
                      <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 mt-0.5
                        ${m.sender === "ai" ? "bg-primary-100 text-primary-700" : "bg-teal-100 text-teal-700"}`}>
                        {m.sender === "ai" ? "AI" : "P"}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className={`text-sm font-semibold ${m.sender === "ai" ? "text-primary-700" : "text-teal-700"}`}>
                            {m.sender === "ai" ? "Care AI" : "Patient"}
                          </span>
                          <span className="text-xs text-text-muted">{fmtDate(m.created_at)}</span>
                        </div>
                        <Markdown text={m.content} />
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {/* ── Summary tab ── */}
          {detailTab === "summary" && (
            <div className="flex-1 overflow-y-auto p-5">
              {!selectedSessionId ? (
                <EmptyState text="Select a session to view its summary." />
              ) : summaryBusy ? (
                <EmptyState text="Loading summary..." />
              ) : summary?.summary_md ? (
                <>
                  <p className="text-xs text-text-muted mb-3">Generated: {fmtDate(summary.summary_at)}</p>
                  <Markdown text={summary.summary_md} />
                </>
              ) : (
                <EmptyState text="No summary available for this session yet." />
              )}
            </div>
          )}

          {/* ── Notes tab ── */}
          {detailTab === "notes" && (
            <div className="flex-1 overflow-y-auto p-5">
              {!selectedSessionId ? (
                <EmptyState text="Select a session to write doctor notes." />
              ) : (
                <>
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-base font-semibold text-text">Doctor Notes</h3>
                    {noteMeta?.updated_at && (
                      <span className="text-xs text-text-muted">Last saved: {fmtDate(noteMeta.updated_at)}</span>
                    )}
                  </div>
                  <textarea
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="Write session notes here. Include prescriptions with duration if needed."
                    disabled={noteBusy}
                    className="w-full min-h-[220px] px-4 py-3 rounded-lg border border-border bg-surface-alt text-text placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent transition resize-y disabled:opacity-60 text-sm leading-relaxed"
                  />
                  <div className="flex items-center gap-3 mt-3">
                    <button
                      onClick={saveNote}
                      disabled={noteBusy || !note.trim()}
                      className="bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium px-5 py-2 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                    >
                      {noteBusy ? "Saving..." : "Save note"}
                    </button>
                    {noteMeta?.extracted_profile_patch && (
                      <span className="text-xs text-success font-medium">
                        Saved to profile
                        {Array.isArray(noteMeta.extracted_profile_patch?.doctor_prescriptions) &&
                        noteMeta.extracted_profile_patch.doctor_prescriptions.length
                          ? ` \u2022 rx: ${noteMeta.extracted_profile_patch.doctor_prescriptions.join("; ")}`
                          : ""}
                      </span>
                    )}
                  </div>
                </>
              )}
            </div>
          )}

          {/* ── Profile tab ── */}
          {detailTab === "profile" && (
            <div className="flex-1 overflow-y-auto p-5">
              {profileBusy ? (
                <EmptyState text="Loading profile..." />
              ) : !selectedPatient ? (
                <EmptyState text="Select a patient to view their profile." />
              ) : !profile ? (
                <EmptyState text="Profile unavailable." />
              ) : (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                  {/* Demographics */}
                  <div className="bg-surface-alt border border-border/60 rounded-xl p-5">
                    <h3 className="text-sm font-semibold text-text mb-4 uppercase tracking-wide">Demographics</h3>
                    <div className="space-y-2.5 text-sm">
                      {[
                        ["Name", profile.full_name || profile.name || "\u2014"],
                        ["Email", profile.email],
                        ["Sex", profile.sex ? String(profile.sex) : "\u2014"],
                        ["Date of birth", profile.date_of_birth ? fmtDate(profile.date_of_birth) : "\u2014"],
                        ["Registered", fmtDate(profile.created_at)],
                      ].map(([label, val]) => (
                        <div key={label} className="flex justify-between py-1.5 border-b border-border/40 last:border-b-0">
                          <span className="text-text-muted">{label}</span>
                          <span className="font-medium text-text text-right">{val}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* AI-extracted */}
                  <div className="bg-surface-alt border border-border/60 rounded-xl p-5">
                    <h3 className="text-sm font-semibold text-text mb-4 uppercase tracking-wide">AI-Extracted Profile</h3>
                    {aiProfile ? (
                      <>
                        <ProfileRow label="Age" value={aiProfile.age} />
                        <ProfileRow label="Sex (from chat)" value={aiProfile.sex} />
                        <ProfileRow label="Chronic conditions" value={aiProfile.chronic_conditions} />
                        <ProfileRow label="Past surgical history" value={aiProfile.past_surgical_history} />
                        <ProfileRow label="Medications" value={medsValue} />
                        <ProfileRow label="Doctor's prescription" value={rxValue} />
                        <ProfileRow label="Allergies" value={aiProfile.allergies} />
                        <ProfileRow label="Social history" value={aiProfile.social_history} />
                        <ProfileRow label="Family history" value={aiProfile.family_history} />
                        <ProfileRow label="Substance use" value={aiProfile.substance_use} />
                        <ProfileRow label="Other notes" value={aiProfile.other_notes} />

                        {profile?.profile?.updated_at && (
                          <p className="text-xs text-text-muted mt-4 pt-2 border-t border-border/40">
                            Last updated: {fmtDate(profile.profile.updated_at)}
                            {profile?.profile?.source_session_id ? ` \u2022 session #${profile.profile.source_session_id}` : ""}
                          </p>
                        )}
                      </>
                    ) : (
                      <p className="text-sm text-text-muted">No AI-extracted profile on file yet.</p>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function EmptyState({ text }) {
  return (
    <div className="flex items-center justify-center h-full min-h-[200px]">
      <p className="text-sm text-text-muted">{text}</p>
    </div>
  );
}
