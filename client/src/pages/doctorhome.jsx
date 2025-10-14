import { useEffect, useState } from "react";
import { auth } from "../auth";

export default function DoctorHome() {
  const token = auth.token();
  const [patients, setPatients] = useState([]);
  const [selected, setSelected] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [messages, setMessages] = useState([]);

  useEffect(() => {
    fetch("/api/doctor/patients", {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.json())
      .then(setPatients);
  }, [token]);

  async function openPatient(p) {
    setSelected(p);
    const s = await fetch(`/api/doctor/patients/${p.user_id}/sessions`, {
      headers: { Authorization: `Bearer ${token}` },
    }).then((r) => r.json());
    setSessions(s);
    setMessages([]);
  }

  async function openSession(id) {
    const msgs = await fetch(`/api/doctor/sessions/${id}/messages`, {
      headers: { Authorization: `Bearer ${token}` },
    }).then((r) => r.json());
    setMessages(msgs);
  }

  return (
    <main
      style={{
        fontFamily: "system-ui",
        padding: 24,
        display: "grid",
        gridTemplateColumns: "260px 280px 1fr",
        gap: 16,
      }}
    >
      <section>
        <h2>Patients</h2>
        <ul style={{ listStyle: "none", padding: 0 }}>
          {patients.map((p) => (
            <li key={p.user_id} style={{ marginBottom: 8 }}>
              <button onClick={() => openPatient(p)} style={{ width: "100%" }}>
                {p.name} <small style={{ opacity: 0.6 }}>({p.email})</small>
              </button>
            </li>
          ))}
          {patients.length === 0 && <p>No patients yet.</p>}
        </ul>
      </section>

      <section>
        <h2>Sessions</h2>
        {selected ? (
          <ul style={{ listStyle: "none", padding: 0 }}>
            {sessions.map((s) => (
              <li key={s.id} style={{ marginBottom: 8 }}>
                <button
                  onClick={() => openSession(s.id)}
                  style={{ width: "100%" }}
                >
                  #{s.id} • {new Date(s.created_at).toLocaleString()} •{" "}
                  {s.status}
                </button>
              </li>
            ))}
            {sessions.length === 0 && <p>No sessions.</p>}
          </ul>
        ) : (
          <p>Select a patient</p>
        )}
      </section>

      <section>
        <h2>Messages</h2>
        <div
          style={{
            border: "1px solid #444",
            borderRadius: 8,
            padding: 12,
            minHeight: 320,
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
          {messages.length === 0 && <p>Open a session to view logs.</p>}
        </div>
      </section>
    </main>
  );
}
