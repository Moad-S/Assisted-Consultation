import { useEffect, useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { auth } from "../auth";
import Markdown from "../components/Markdown";

export default function DoctorHome() {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage?.startsWith("es") ? "es-ES" : "en-US";
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

  const [detailTab, setDetailTab] = useState("messages");

  useEffect(() => {
    (async () => {
      const res = await fetch("/api/doctor/patients", { headers: authHeader });
      const data = await res.json();
      setPatients(data || []);
    })();
  }, [token]);

  function fmtDate(dt) {
    try { return new Date(dt).toLocaleString(locale); } catch { return dt ?? ""; }
  }

  function formatSex(value) {
    const key = String(value || "").trim().toLowerCase();
    const translated = ["male", "female", "intersex", "other", "prefer_not_to_say"].includes(key)
      ? t(`common.sex.${key}`)
      : null;
    return translated || String(value || "\u2014");
  }

  function isSubstanceUse(value) {
    return (
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      ["smoking", "alcohol", "drugs"].some((key) => value[key] !== undefined)
    );
  }

  function formatSubstanceValue(value) {
    if (value === null || value === undefined || value === "") {
      return t("common.notDocumented");
    }
    return t(`doctor.substanceLabels.values.${String(value).trim().toLowerCase()}`, {
      defaultValue: String(value),
    });
  }

  function ProfileRow({ label, value }) {
    if (
      value === null || value === undefined ||
      (typeof value === "string" && value.trim() === "") ||
      (Array.isArray(value) && value.length === 0)
    ) return null;

    return (
      <div className="mb-4">
        <div className="text-xs font-semibold text-ink-muted uppercase tracking-wider mb-1.5">{label}</div>
        {isSubstanceUse(value) ? (
          <dl className="space-y-2 text-sm text-ink">
            {["smoking", "alcohol", "drugs"].map((key) => (
              value[key] !== undefined && (
                <div key={key} className="flex justify-between gap-4">
                  <dt className="text-ink-muted">{t(`doctor.substanceLabels.${key}`)}</dt>
                  <dd className="font-medium text-right">{formatSubstanceValue(value[key])}</dd>
                </div>
              )
            ))}
          </dl>
        ) : Array.isArray(value) ? (
          <ul className="space-y-1">
            {value.map((v, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-ink">
                <span className="w-1.5 h-1.5 rounded-full bg-primary-400 shrink-0 mt-1.5" />
                {typeof v === "string" ? v : JSON.stringify(v)}
              </li>
            ))}
          </ul>
        ) : typeof value === "string" ? (
          <div className="text-sm text-ink"><Markdown text={value} /></div>
        ) : (
          <pre className="text-xs font-mono bg-canvas p-3 rounded-xl overflow-x-auto whitespace-pre-wrap break-words text-ink">
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
    } catch {
      // A missing note is equivalent to an empty note for this session.
    }
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
      if (!res.ok) throw new Error(data?.error || t("errors.failedToSaveNote"));
      setNoteMeta({ updated_at: data.updated_at, extracted_profile_patch: data.extracted_profile_patch || null });
      await refreshProfile(selectedPatient?.user_id);
    } catch (e) { alert(e.message || t("errors.saveFailed")); }
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
    if (Array.isArray(v)) return v.length ? v : t("common.notDocumented");
    if (typeof v === "string") return v.trim() ? v : t("common.notDocumented");
    return v ? v : t("common.notDocumented");
  }, [aiProfile, t]);

  const rxValue = useMemo(() => {
    if (!aiProfile) return null;
    const v = aiProfile.doctor_prescriptions;
    if (Array.isArray(v)) return v.length ? v : t("common.noneDocumented");
    if (typeof v === "string") return v.trim() ? v : t("common.noneDocumented");
    return v ? v : t("common.noneDocumented");
  }, [aiProfile, t]);

  const sessionLabel = useMemo(() => {
    const sorted = [...(sessions || [])].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    const map = {};
    sorted.forEach((s, i) => { map[s.id] = i + 1; });
    return (id) => map[id] ?? id;
  }, [sessions]);

  const tabs = [
    { id: "messages", label: t("doctor.tabs.messages"), icon: <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/> },
    { id: "summary", label: t("doctor.tabs.summary"), icon: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></> },
    { id: "notes", label: t("doctor.tabs.notes"), icon: <><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></> },
    { id: "profile", label: t("doctor.tabs.profile"), icon: <><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></> },
  ];

  return (
    <div className="flex flex-col lg:flex-row gap-5 -mx-5 sm:-mx-8 px-5 sm:px-8 lg:h-[calc(100vh-7rem)]">

      {/* ─── LEFT SIDEBAR ─── */}
      <aside className="w-full lg:w-72 shrink-0 flex flex-col gap-4 lg:overflow-hidden">

        {/* Patients */}
        <div className="bg-white rounded-2xl border border-border shadow-sm flex flex-col min-h-0 flex-1 max-h-64 lg:max-h-none">
          <div className="px-5 pt-5 pb-3 flex items-center gap-2">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-ink-muted">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
            </svg>
            <h2 className="font-display text-sm font-semibold text-ink">{t("doctor.patients")}</h2>
          </div>
          <div className="flex-1 overflow-y-auto px-3 pb-3 space-y-1">
            {patients.map((p) => (
              <button
                key={p.user_id}
                onClick={() => openPatient(p)}
                className={`w-full text-left px-3.5 py-3 rounded-xl transition-all cursor-pointer
                  ${selectedPatient?.user_id === p.user_id
                    ? "bg-primary-50 ring-1 ring-primary-200"
                    : "hover:bg-canvas"
                  }`}
              >
                <div className="flex items-center gap-3">
                  <div className={`w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold shrink-0
                    ${selectedPatient?.user_id === p.user_id ? "bg-primary-600 text-white" : "bg-canvas text-ink-muted"}`}>
                    {(p.name || "?")[0].toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <div className="font-medium text-ink text-sm truncate">{p.name}</div>
                    <div className="text-xs text-ink-faint truncate">{p.email}</div>
                  </div>
                </div>
              </button>
            ))}
            {patients.length === 0 && (
              <p className="text-sm text-ink-faint py-8 text-center">{t("doctor.noPatients")}</p>
            )}
          </div>
        </div>

        {/* Sessions */}
        <div className="bg-white rounded-2xl border border-border shadow-sm flex flex-col min-h-0 flex-1 max-h-64 lg:max-h-none">
          <div className="px-5 pt-5 pb-3 flex items-center gap-2">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-ink-muted">
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
            </svg>
            <h2 className="font-display text-sm font-semibold text-ink">
              {t("doctor.sessions")}
              {selectedPatient && <span className="text-ink-faint font-normal ml-1">({selectedPatient.name})</span>}
            </h2>
          </div>
          <div className="flex-1 overflow-y-auto px-3 pb-3 space-y-1">
            {!selectedPatient ? (
              <p className="text-sm text-ink-faint py-8 text-center">{t("doctor.selectPatient")}</p>
            ) : sessionsBusy ? (
              <p className="text-sm text-ink-faint py-8 text-center">{t("common.loading")}</p>
            ) : sessions.length === 0 ? (
              <p className="text-sm text-ink-faint py-8 text-center">{t("doctor.noSessions")}</p>
            ) : (
              sessions.map((s) => (
                <button
                  key={s.id}
                  onClick={() => openSession(s.id)}
                  className={`w-full text-left px-3.5 py-3 rounded-xl transition-all cursor-pointer
                    ${s.id === selectedSessionId
                      ? "bg-primary-50 ring-1 ring-primary-200"
                      : "hover:bg-canvas"
                    }`}
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="font-display font-semibold text-sm text-ink">#{sessionLabel(s.id)}</span>
                    <span className="text-[11px] text-ink-faint">{fmtDate(s.created_at)}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full uppercase tracking-wide
                      ${s.status === "active" ? "bg-green-100 text-green-700" : "bg-canvas text-ink-faint"}`}>
                      {t(`common.status.${s.status}`, s.status)}
                    </span>
                    {!!s.summary_at && (
                      <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-doctor-soft text-doctor ml-auto">
                        {t("doctor.summaryBadge")}
                      </span>
                    )}
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      </aside>

      {/* ─── MAIN CONTENT ─── */}
      <div className="flex-1 flex flex-col min-w-0 min-h-0">

        {/* Tabs */}
        <div className="flex flex-wrap items-center gap-1 mb-4 bg-white rounded-2xl border border-border shadow-sm p-1.5">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setDetailTab(t.id)}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition cursor-pointer
                ${detailTab === t.id
                  ? "bg-ink text-white shadow-sm"
                  : "text-ink-muted hover:text-ink hover:bg-canvas"
                }`}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                {t.icon}
              </svg>
              {t.label}
              {t.id === "messages" && selectedSessionId ? ` #${sessionLabel(selectedSessionId)}` : ""}
            </button>
          ))}

          {selectedPatient && (
            <span className="ml-auto text-sm text-ink-faint pr-3 font-display">
              {selectedPatient.name}
              {selectedSessionId ? <> &middot; #{sessionLabel(selectedSessionId)}</> : ""}
            </span>
          )}
        </div>

        {/* Content area */}
        <div className="flex-1 bg-white rounded-2xl border border-border shadow-sm overflow-hidden flex flex-col min-h-[50vh] lg:min-h-0">

          {/* Messages tab */}
          {detailTab === "messages" && (
            <div className="flex-1 overflow-y-auto p-6 space-y-1">
              {!selectedSessionId ? (
                <EmptyState icon={<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>} text={t("doctor.selectPatientSession")} />
              ) : messagesBusy ? (
                <EmptyState text={t("doctor.loadingMessages")} />
              ) : messages.length === 0 ? (
                <EmptyState text={t("doctor.noMessagesInSession")} />
              ) : (
                messages.map((m) => (
                  <div key={m.id} className="py-3 border-b border-border-subtle last:border-b-0">
                    <div className="flex items-start gap-3">
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0 mt-0.5
                        ${m.sender === "ai" ? "bg-primary-100 text-primary-700" : "bg-doctor-soft text-doctor"}`}>
                        {m.sender === "ai" ? t("doctor.avatarAI") : t("doctor.avatarP")}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className={`text-sm font-semibold ${m.sender === "ai" ? "text-primary-700" : "text-doctor"}`}>
                            {m.sender === "ai" ? t("doctor.careAI") : t("doctor.patientLabel")}
                          </span>
                          <span className="text-[11px] text-ink-faint">{fmtDate(m.created_at)}</span>
                        </div>
                        <Markdown text={m.content} />
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {/* Summary tab */}
          {detailTab === "summary" && (
            <div className="flex-1 overflow-y-auto p-6">
              {!selectedSessionId ? (
                <EmptyState icon={<><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></>} text={t("doctor.selectSessionSummary")} />
              ) : summaryBusy ? (
                <EmptyState text={t("doctor.loadingSummary")} />
              ) : summary?.summary_md ? (
                <>
                  <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-canvas text-ink-faint text-xs font-medium mb-4">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                    {fmtDate(summary.summary_at)}
                  </div>
                  <Markdown text={summary.summary_md} />
                </>
              ) : (
                <EmptyState text={t("doctor.noSummary")} />
              )}
            </div>
          )}

          {/* Notes tab */}
          {detailTab === "notes" && (
            <div className="flex-1 overflow-y-auto p-6">
              {!selectedSessionId ? (
                <EmptyState icon={<><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></>} text={t("doctor.selectSessionNotes")} />
              ) : (
                <>
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="font-display text-base font-semibold text-ink">{t("doctor.doctorNotes")}</h3>
                    {noteMeta?.updated_at && (
                      <span className="text-xs text-ink-faint">{t("doctor.saved", { date: fmtDate(noteMeta.updated_at) })}</span>
                    )}
                  </div>
                  <textarea
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder={t("doctor.notesPlaceholder")}
                    disabled={noteBusy}
                    className="w-full min-h-[220px] px-5 py-4 rounded-xl border border-border bg-canvas/50 text-ink placeholder:text-ink-faint focus:ring-2 focus:ring-primary-400 focus:border-primary-400 transition resize-y disabled:opacity-50 text-sm leading-relaxed"
                  />
                  <div className="flex items-center gap-3 mt-4">
                    <button
                      onClick={saveNote}
                      disabled={noteBusy || !note.trim()}
                      className="bg-primary-600 hover:bg-primary-700 text-white text-sm font-semibold px-6 py-2.5 rounded-full transition-all shadow-sm hover:shadow-md disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                    >
                      {noteBusy ? t("doctor.saving") : t("doctor.saveNote")}
                    </button>
                    {noteMeta?.extracted_profile_patch && (
                      <span className="flex items-center gap-1.5 text-xs text-success font-medium">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
                        {t("doctor.savedToProfile")}
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

          {/* Profile tab */}
          {detailTab === "profile" && (
            <div className="flex-1 overflow-y-auto p-6">
              {profileBusy ? (
                <EmptyState text={t("doctor.loadingProfile")} />
              ) : !selectedPatient ? (
                <EmptyState icon={<><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></>} text={t("doctor.selectPatientProfile")} />
              ) : !profile ? (
                <EmptyState text={t("doctor.profileUnavailable")} />
              ) : (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                  {/* Demographics card */}
                  <div className="bg-canvas rounded-2xl p-6">
                    <h3 className="font-display text-xs font-semibold text-ink-muted mb-5 uppercase tracking-wider">{t("doctor.demographics")}</h3>
                    <div className="space-y-0">
                      {[
                        [t("doctor.rowName"), profile.full_name || profile.name || "\u2014"],
                        [t("doctor.rowEmail"), profile.email],
                        [t("doctor.rowSex"), formatSex(profile.sex)],
                        [t("doctor.rowDob"), profile.date_of_birth ? fmtDate(profile.date_of_birth) : "\u2014"],
                        [t("doctor.rowRegistered"), fmtDate(profile.created_at)],
                      ].map(([label, val]) => (
                        <div key={label} className="flex justify-between py-3 border-b border-border-subtle last:border-b-0">
                          <span className="text-sm text-ink-muted">{label}</span>
                          <span className="text-sm font-medium text-ink text-right">{val}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* AI Profile card */}
                  <div className="bg-canvas rounded-2xl p-6">
                    <h3 className="font-display text-xs font-semibold text-ink-muted mb-5 uppercase tracking-wider">{t("doctor.aiProfile")}</h3>
                    {aiProfile ? (
                      <>
                        <ProfileRow label={t("doctor.profileRows.age")} value={aiProfile.age} />
                        <ProfileRow label={t("doctor.profileRows.sexFromChat")} value={aiProfile.sex} />
                        <ProfileRow label={t("doctor.profileRows.chronic")} value={aiProfile.chronic_conditions} />
                        <ProfileRow label={t("doctor.profileRows.pastSurgical")} value={aiProfile.past_surgical_history} />
                        <ProfileRow label={t("doctor.profileRows.medications")} value={medsValue} />
                        <ProfileRow label={t("doctor.profileRows.doctorRx")} value={rxValue} />
                        <ProfileRow label={t("doctor.profileRows.allergies")} value={aiProfile.allergies} />
                        <ProfileRow label={t("doctor.profileRows.socialHistory")} value={aiProfile.social_history} />
                        <ProfileRow label={t("doctor.profileRows.familyHistory")} value={aiProfile.family_history} />
                        <ProfileRow label={t("doctor.profileRows.substanceUse")} value={aiProfile.substance_use} />
                        <ProfileRow label={t("doctor.profileRows.otherNotes")} value={aiProfile.other_notes} />

                        {profile?.profile?.updated_at && (
                          <p className="text-xs text-ink-faint mt-5 pt-3 border-t border-border-subtle">
                            {t("doctor.updated", { date: fmtDate(profile.profile.updated_at) })}
                            {profile?.profile?.source_session_id ? ` \u2022 ${t("doctor.sessionSuffix", { id: profile.profile.source_session_id })}` : ""}
                          </p>
                        )}
                      </>
                    ) : (
                      <p className="text-sm text-ink-faint">{t("doctor.noAiProfile")}</p>
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

function EmptyState({ text, icon }) {
  return (
    <div className="flex flex-col items-center justify-center h-full min-h-[200px]">
      {icon && (
        <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-ink-faint/40 mb-3">
          {icon}
        </svg>
      )}
      <p className="text-sm text-ink-faint">{text}</p>
    </div>
  );
}
