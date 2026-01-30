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
  const [noteMeta, setNoteMeta] = useState(null); // { updated_at, extracted_profile_patch? }

  useEffect(() => {
    (async () => {
      const res = await fetch("/api/doctor/patients", { headers: authHeader });
      const data = await res.json();
      setPatients(data || []);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  function fmtDate(dt) {
    try {
      return new Date(dt).toLocaleString();
    } catch {
      return dt ?? "";
    }
  }

  function ProfileRow({ label, value }) {
    if (
      value === null ||
      value === undefined ||
      (typeof value === "string" && value.trim() === "") ||
      (Array.isArray(value) && value.length === 0)
    ) {
      return null;
    }
    return (
      <div style={{ marginBottom: 6 }}>
        <div style={{ fontWeight: 600, opacity: 0.9 }}>{label}</div>
        {Array.isArray(value) ? (
          <ul style={{ margin: "4px 0 0 18px" }}>
            {value.map((v, i) => (
              <li key={i} style={{ lineHeight: 1.4 }}>
                {typeof v === "string" ? v : JSON.stringify(v)}
              </li>
            ))}
          </ul>
        ) : typeof value === "string" ? (
          <div style={{ marginTop: 2 }}>
            <Markdown text={value} />
          </div>
        ) : (
          <pre
            style={{
              margin: 0,
              marginTop: 2,
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              fontFamily:
                "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
              fontSize: 12,
              opacity: 0.95,
            }}
          >
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
      const data = await fetch(`/api/doctor/patients/${pid}/profile`, {
        headers: authHeader,
      }).then((r) => r.json());
      setProfile(data || null);
    } finally {
      setProfileBusy(false);
    }
  }

  async function openPatient(p) {
    setSelectedPatient(p);
    setSelectedSessionId(null);
    setMessages([]);
    setSummary(null);
    setProfile(null);

    setNote("");
    setNoteMeta(null);

    setSessionsBusy(true);
    setProfileBusy(true);
    try {
      const [sessionsResp, profileResp] = await Promise.all([
        fetch(`/api/doctor/patients/${p.user_id}/sessions`, {
          headers: authHeader,
        }).then((r) => r.json()),
        fetch(`/api/doctor/patients/${p.user_id}/profile`, {
          headers: authHeader,
        }).then((r) => r.json()),
      ]);
      setSessions(sessionsResp || []);
      setProfile(profileResp || null);
    } finally {
      setSessionsBusy(false);
      setProfileBusy(false);
    }
  }

  async function loadNote(sessionId) {
    setNote("");
    setNoteMeta(null);
    try {
      const n = await fetch(`/api/doctor/sessions/${sessionId}/note`, {
        headers: authHeader,
      }).then(async (r) => {
        if (!r.ok) return null;
        return r.json();
      });

      if (n && n.note_md) {
        setNote(n.note_md);
        setNoteMeta({ updated_at: n.updated_at });
      } else {
        setNote("");
        setNoteMeta(null);
      }
    } catch {
      setNote("");
      setNoteMeta(null);
    }
  }

  async function saveNote() {
    if (!selectedSessionId) return;
    if (!note.trim()) return;

    setNoteBusy(true);
    try {
      const res = await fetch(
        `/api/doctor/sessions/${selectedSessionId}/note`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeader },
          body: JSON.stringify({ note_md: note }),
        }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed to save note");

      setNoteMeta({
        updated_at: data.updated_at,
        extracted_profile_patch: data.extracted_profile_patch || null,
      });

      await refreshProfile(selectedPatient?.user_id);
    } catch (e) {
      alert(e.message || "Save failed");
    } finally {
      setNoteBusy(false);
    }
  }

  async function openSession(id) {
    setSelectedSessionId(id);
    setMessages([]);
    setSummary(null);

    loadNote(id);

    setMessagesBusy(true);
    try {
      const msgs = await fetch(`/api/doctor/sessions/${id}/messages`, {
        headers: authHeader,
      }).then((r) => r.json());
      setMessages(msgs || []);
    } finally {
      setMessagesBusy(false);
    }

    setSummaryBusy(true);
    try {
      const s = await fetch(`/api/doctor/sessions/${id}/summary`, {
        headers: authHeader,
      }).then(async (r) => {
        if (!r.ok) return null;
        return r.json();
      });
      setSummary(s);
    } finally {
      setSummaryBusy(false);
    }
  }

  function SessionRow({ s }) {
    const hasSummary = !!s.summary_at;
    return (
      <button
        onClick={() => openSession(s.id)}
        style={{
          width: "100%",
          textAlign: "left",
          padding: "8px 10px",
          borderRadius: 8,
          border:
            s.id === selectedSessionId ? "2px solid #8aa9ff" : "1px solid #444",
          background: "#111",
        }}
      >
        <div>
          <strong>#{s.id}</strong>{" "}
          <small style={{ opacity: 0.7 }}>{fmtDate(s.created_at)}</small>
        </div>
        <div
          style={{
            display: "flex",
            gap: 8,
            marginTop: 2,
            alignItems: "center",
          }}
        >
          <span
            style={{
              fontSize: 12,
              padding: "2px 6px",
              borderRadius: 6,
              background: s.status === "active" ? "#133814" : "#222",
              border: "1px solid #2d2d2d",
            }}
          >
            {s.status}
          </span>
          {s.ended_at && (
            <small style={{ opacity: 0.6 }}>ended {fmtDate(s.ended_at)}</small>
          )}
          {hasSummary && (
            <span
              title="Summary available"
              style={{
                marginLeft: "auto",
                fontSize: 12,
                padding: "2px 6px",
                borderRadius: 6,
                background: "#16233a",
                border: "1px solid #2a3f62",
              }}
            >
              ✅ summary
            </span>
          )}
        </div>
      </button>
    );
  }

  const aiProfile = useMemo(() => {
    const d = profile?.profile?.data;
    return d && typeof d === "object" ? d : null;
  }, [profile]);

  // Keep these visible even if empty (prevents “it only appears after doctor note”)
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

  return (
    <main
      style={{
        fontFamily: "system-ui",
        padding: 24,
        display: "grid",
        gridTemplateColumns: "260px 300px 1fr 1fr 320px",
        gap: 16,
      }}
    >
      {/* Patients */}
      <section>
        <h2>Patients</h2>
        <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {patients.map((p) => (
            <li key={p.user_id} style={{ marginBottom: 8 }}>
              <button
                onClick={() => openPatient(p)}
                style={{
                  width: "100%",
                  textAlign: "left",
                  padding: "8px 10px",
                  borderRadius: 8,
                  border:
                    selectedPatient?.user_id === p.user_id
                      ? "2px solid #8aa9ff"
                      : "1px solid #444",
                  background: "#111",
                }}
              >
                <div>{p.name}</div>
                <small style={{ opacity: 0.6 }}>{p.email}</small>
              </button>
            </li>
          ))}
          {patients.length === 0 && <p>No patients yet.</p>}
        </ul>
      </section>

      {/* Sessions */}
      <section>
        <h2>Sessions</h2>
        {selectedPatient ? (
          sessionsBusy ? (
            <p>Loading sessions…</p>
          ) : (
            <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
              {sessions.map((s) => (
                <li key={s.id} style={{ marginBottom: 8 }}>
                  <SessionRow s={s} />
                </li>
              ))}
              {sessions.length === 0 && <p>No sessions.</p>}
            </ul>
          )
        ) : (
          <p>Select a patient</p>
        )}
      </section>

      {/* Messages */}
      <section>
        <h2>Messages {selectedSessionId ? `(#${selectedSessionId})` : ""}</h2>
        <div
          style={{
            border: "1px solid #444",
            borderRadius: 8,
            padding: 12,
            minHeight: 320,
            background: "#0c0c0c",
          }}
        >
          {messagesBusy ? (
            <p>Loading messages…</p>
          ) : messages.length > 0 ? (
            messages.map((m) => (
              <div key={m.id} style={{ margin: "6px 0" }}>
                <strong>{m.sender}:</strong>{" "}
                <span style={{ display: "inline-block", verticalAlign: "top" }}>
                  <Markdown text={m.content} />
                </span>
                <small style={{ opacity: 0.6, marginLeft: 8 }}>
                  {fmtDate(m.created_at)}
                </small>
              </div>
            ))
          ) : (
            <p>
              {selectedSessionId
                ? "No messages in this session."
                : "Open a session to view logs."}
            </p>
          )}
        </div>
      </section>

      {/* Summary + Doctor Notes */}
      <section>
        <h2>Summary</h2>
        <div
          style={{
            border: "1px solid #444",
            borderRadius: 8,
            padding: 12,
            minHeight: 320,
            background: "#0c0c0c",
          }}
        >
          {summaryBusy ? (
            <p>Loading summary…</p>
          ) : summary?.summary_md ? (
            <>
              <div style={{ marginBottom: 8 }}>
                <small style={{ opacity: 0.7 }}>
                  Generated: {fmtDate(summary.summary_at)}
                </small>
              </div>
              <Markdown text={summary.summary_md} />
            </>
          ) : selectedSessionId ? (
            <p>No summary available for this session yet.</p>
          ) : (
            <p>Open a session to view its summary.</p>
          )}

          {/* Doctor Notes */}
          <div
            style={{
              marginTop: 14,
              paddingTop: 12,
              borderTop: "1px solid #222",
            }}
          >
            <h3 style={{ margin: "0 0 8px" }}>
              Doctor Notes (saved to profile)
            </h3>

            {!selectedSessionId ? (
              <p style={{ opacity: 0.75 }}>Open a session to write notes.</p>
            ) : (
              <>
                {noteMeta?.updated_at && (
                  <div style={{ marginBottom: 8 }}>
                    <small style={{ opacity: 0.7 }}>
                      Last saved: {fmtDate(noteMeta.updated_at)}
                    </small>
                  </div>
                )}

                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Write session notes (include prescriptions here if needed, with duration)."
                  style={{
                    width: "100%",
                    minHeight: 140,
                    padding: 10,
                    borderRadius: 8,
                    border: "1px solid #333",
                    background: "#0b0b0b",
                    color: "inherit",
                    resize: "vertical",
                  }}
                  disabled={noteBusy}
                />

                <div
                  style={{
                    display: "flex",
                    gap: 8,
                    marginTop: 8,
                    alignItems: "center",
                  }}
                >
                  <button
                    onClick={saveNote}
                    disabled={noteBusy || !note.trim()}
                  >
                    {noteBusy ? "Saving..." : "Save note"}
                  </button>

                  {noteMeta?.extracted_profile_patch ? (
                    <small style={{ opacity: 0.75 }}>
                      Saved to profile
                      {Array.isArray(
                        noteMeta.extracted_profile_patch?.doctor_prescriptions
                      ) &&
                      noteMeta.extracted_profile_patch.doctor_prescriptions
                        .length
                        ? ` • rx: ${noteMeta.extracted_profile_patch.doctor_prescriptions.join(
                            "; "
                          )}`
                        : ""}
                    </small>
                  ) : null}
                </div>
              </>
            )}
          </div>
        </div>
      </section>

      {/* Profile */}
      <section>
        <h2>Profile</h2>
        <div
          style={{
            border: "1px solid #444",
            borderRadius: 8,
            padding: 12,
            minHeight: 320,
            background: "#0c0c0c",
          }}
        >
          {profileBusy ? (
            <p>Loading profile…</p>
          ) : !selectedPatient ? (
            <p>Select a patient to view profile.</p>
          ) : profile ? (
            <>
              <div
                style={{
                  padding: 8,
                  borderRadius: 8,
                  border: "1px solid #333",
                  background: "#0e0e0e",
                  marginBottom: 10,
                }}
              >
                <div style={{ fontWeight: 700, marginBottom: 6 }}>
                  Demographics
                </div>
                <div style={{ marginBottom: 4 }}>
                  <strong>Name:</strong>{" "}
                  {profile.full_name || profile.name || "—"}
                </div>
                <div style={{ marginBottom: 4 }}>
                  <strong>Email:</strong> {profile.email}
                </div>
                <div style={{ marginBottom: 4 }}>
                  <strong>Sex:</strong>{" "}
                  {profile.sex ? String(profile.sex) : "—"}
                </div>
                <div style={{ marginBottom: 4 }}>
                  <strong>Date of birth:</strong>{" "}
                  {profile.date_of_birth ? fmtDate(profile.date_of_birth) : "—"}
                </div>
                <div style={{ marginBottom: 4 }}>
                  <strong>Registered:</strong> {fmtDate(profile.created_at)}
                </div>
              </div>

              <div
                style={{
                  padding: 8,
                  borderRadius: 8,
                  border: "1px solid #333",
                  background: "#0e0e0e",
                }}
              >
                <div style={{ fontWeight: 700, marginBottom: 6 }}>
                  AI-extracted profile
                </div>

                {aiProfile ? (
                  <>
                    <ProfileRow label="Age" value={aiProfile.age} />
                    <ProfileRow label="Sex (from chat)" value={aiProfile.sex} />
                    <ProfileRow
                      label="Chronic conditions"
                      value={aiProfile.chronic_conditions}
                    />
                    <ProfileRow
                      label="Past surgical history"
                      value={aiProfile.past_surgical_history}
                    />

                    {/* Always visible (fallback strings) */}
                    <ProfileRow label="Medications" value={medsValue} />
                    <ProfileRow label="Doctor's prescription" value={rxValue} />

                    <ProfileRow label="Allergies" value={aiProfile.allergies} />
                    <ProfileRow
                      label="Social history"
                      value={aiProfile.social_history}
                    />
                    <ProfileRow
                      label="Family history"
                      value={aiProfile.family_history}
                    />
                    <ProfileRow
                      label="Substance use"
                      value={aiProfile.substance_use}
                    />
                    <ProfileRow
                      label="Other notes"
                      value={aiProfile.other_notes}
                    />

                    {profile?.profile?.updated_at && (
                      <div style={{ marginTop: 6 }}>
                        <small style={{ opacity: 0.7 }}>
                          Last updated: {fmtDate(profile.profile.updated_at)}
                          {profile?.profile?.source_session_id
                            ? ` • from session #${profile.profile.source_session_id}`
                            : ""}
                        </small>
                      </div>
                    )}
                  </>
                ) : (
                  <p style={{ opacity: 0.8 }}>
                    No AI-extracted profile on file yet.
                  </p>
                )}
              </div>
            </>
          ) : (
            <p>Profile unavailable.</p>
          )}
        </div>
      </section>
    </main>
  );
}
