// client/src/pages/doctorhome.jsx
import { useEffect, useState } from "react";
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

  const [summary, setSummary] = useState(null); // { summary_md, summary_at, ... }
  const [summaryBusy, setSummaryBusy] = useState(false);

  // Load patients once
  useEffect(() => {
    (async () => {
      const res = await fetch("/api/doctor/patients", { headers: authHeader });
      const data = await res.json();
      setPatients(data || []);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function openPatient(p) {
    setSelectedPatient(p);
    setSelectedSessionId(null);
    setMessages([]);
    setSummary(null);

    setSessionsBusy(true);
    try {
      const data = await fetch(`/api/doctor/patients/${p.user_id}/sessions`, {
        headers: authHeader,
      }).then((r) => r.json());
      setSessions(data || []);
    } finally {
      setSessionsBusy(false);
    }
  }

  async function openSession(id) {
    setSelectedSessionId(id);
    setMessages([]);
    setSummary(null);

    // Messages
    setMessagesBusy(true);
    try {
      const msgs = await fetch(`/api/doctor/sessions/${id}/messages`, {
        headers: authHeader,
      }).then((r) => r.json());
      setMessages(msgs || []);
    } finally {
      setMessagesBusy(false);
    }

    // Summary (if available)
    setSummaryBusy(true);
    try {
      const s = await fetch(`/api/doctor/sessions/${id}/summary`, {
        headers: authHeader,
      }).then(async (r) => {
        if (!r.ok) return null; // 404 etc.
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
          <small style={{ opacity: 0.7 }}>
            {new Date(s.created_at).toLocaleString()}
          </small>
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
            <small style={{ opacity: 0.6 }}>
              ended {new Date(s.ended_at).toLocaleString()}
            </small>
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

  return (
    <main
      style={{
        fontFamily: "system-ui",
        padding: 24,
        display: "grid",
        gridTemplateColumns: "260px 300px 1fr 1fr",
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
                <strong>{m.sender}:</strong> <Markdown text={m.content} />
                <small style={{ opacity: 0.6, marginLeft: 8 }}>
                  {new Date(m.created_at).toLocaleString()}
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

      {/* Summary */}
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
                  Generated: {new Date(summary.summary_at).toLocaleString()}
                </small>
              </div>
              <Markdown text={summary.summary_md} />
            </>
          ) : selectedSessionId ? (
            <p>No summary available for this session yet.</p>
          ) : (
            <p>Open a session to view its summary.</p>
          )}
        </div>
      </section>
    </main>
  );
}
