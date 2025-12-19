// server/routes/doctor.js
const router = require("express").Router();
const { pool } = require("../db");
const { requireAuth, requireRole } = require("../middleware/authz");

// NEW: for medication extraction from doctor notes
const { GoogleGenerativeAI } = require("@google/generative-ai");
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
const MODEL_NAME = process.env.GEMINI_MODEL || "gemini-2.0-flash-lite";

const DEFAULT_NOTE_MED_EXTRACT_PROMPT = `
You extract ONLY clinician-prescribed medication instructions from a doctor's note.

Return STRICT JSON ONLY:
{
  "medications": string[] | null
}

Rules:
- Include only meds that are being prescribed/recommended by the doctor.
- Keep any dose/route/frequency/duration if written (e.g., "Amoxicillin 500mg PO TID x 7 days").
- If duration is present, keep it in the same string.
- If stopping a medication is explicitly instructed, include it as "DISCONTINUE: <med>".
- If no prescribed meds are present, return {"medications": null}.
- Do not invent anything.
`;

const NOTE_MED_EXTRACT_PROMPT = (
  process.env.GEMINI_NOTE_MED_EXTRACT_PROMPT || DEFAULT_NOTE_MED_EXTRACT_PROMPT
).trim();

function safeText(x) {
  return String(x == null ? "" : x);
}

function extractFirstJsonObject(text) {
  const s = safeText(text);
  const start = s.indexOf("{");
  if (start === -1) return null;

  let depth = 0;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (ch === "{") depth++;
    if (ch === "}") depth--;
    if (depth === 0) {
      const candidate = s.slice(start, i + 1);
      try {
        return JSON.parse(candidate);
      } catch {
        return null;
      }
    }
  }
  return null;
}

function normalizeList(v) {
  if (!v) return [];
  if (Array.isArray(v)) return v.map((s) => safeText(s).trim()).filter(Boolean);
  if (typeof v === "string") {
    const t = v.trim();
    return t ? [t] : [];
  }
  return [];
}

function dedupePreserve(arr) {
  const out = [];
  const seen = new Set();
  for (const item of arr) {
    const t = safeText(item).trim();
    if (!t) continue;
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}

async function getSessionPatientId(sessionId) {
  const { rows } = await pool.query(
    `SELECT patient_id FROM care_ai.chat_sessions WHERE id = $1 LIMIT 1`,
    [sessionId]
  );
  return rows[0]?.patient_id || null;
}

async function extractMedsFromDoctorNote(noteMd) {
  const text = safeText(noteMd).trim();
  if (!text) return null;

  try {
    const model = genAI.getGenerativeModel({
      model: MODEL_NAME,
      systemInstruction: NOTE_MED_EXTRACT_PROMPT,
    });

    const result = await model.generateContent([
      {
        text:
          "Extract prescribed medications as STRICT JSON ONLY.\n\nDoctor note:\n" +
          text,
      },
    ]);

    const raw =
      result?.response?.text?.() ||
      result?.response?.candidates?.[0]?.content?.parts?.[0]?.text ||
      "";

    const parsed = extractFirstJsonObject(raw);
    if (!parsed) return null;

    const meds = normalizeList(parsed.medications);
    return meds.length ? meds : null;
  } catch (e) {
    console.warn("[doctor note] med extraction failed:", e?.message || e);
    return null;
  }
}

async function upsertPatientProfileFromDoctorNote({
  patientId,
  sessionId,
  doctorId,
  noteMd,
  meds,
}) {
  // patient_profiles may not exist yet; fail safely
  let existing = {};
  try {
    const { rows } = await pool.query(
      `SELECT data FROM care_ai.patient_profiles WHERE patient_id = $1 LIMIT 1`,
      [patientId]
    );
    existing = (rows[0] && rows[0].data) || {};
  } catch (err) {
    // undefined_table: 42P01
    if (err?.code !== "42P01") {
      console.error("[doctor note] profile read error:", err.message || err);
    }
    return;
  }

  const merged = { ...(existing || {}) };

  // merge meds into profile.data.medications
  if (meds && meds.length) {
    const prev = normalizeList(merged.medications);
    merged.medications = dedupePreserve([...prev, ...meds]);
  }

  // store clinician notes (per session; replace if same session)
  const prevNotes = Array.isArray(merged.clinician_notes)
    ? merged.clinician_notes
    : [];

  const nowIso = new Date().toISOString();
  const noteEntry = {
    session_id: sessionId,
    doctor_id: doctorId,
    note_md: safeText(noteMd || ""),
    updated_at: nowIso,
  };

  const withoutThisSession = prevNotes.filter(
    (n) => String(n?.session_id) !== String(sessionId)
  );
  merged.clinician_notes = [...withoutThisSession, noteEntry];

  // upsert profile
  try {
    await pool.query(
      `
      INSERT INTO care_ai.patient_profiles (patient_id, data, updated_at, source_session_id)
      VALUES ($1, $2, NOW(), $3)
      ON CONFLICT (patient_id)
      DO UPDATE SET data = EXCLUDED.data,
                    updated_at = NOW(),
                    source_session_id = EXCLUDED.source_session_id
    `,
      [patientId, merged, sessionId]
    );
  } catch (err) {
    // undefined_table: 42P01
    if (err?.code !== "42P01") {
      console.error("[doctor note] profile upsert error:", err.message || err);
    }
  }
}

/** List all registered patients (simple MVP) */
router.get(
  "/patients",
  requireAuth,
  requireRole("doctor"),
  async (_req, res) => {
    const { rows } = await pool.query(`
    SELECT u.id AS user_id,
           COALESCE(p.full_name, u.display_name, u.email) AS name,
           u.email, p.date_of_birth, p.sex, u.created_at
      FROM care_ai.users u
      JOIN care_ai.patients p ON p.user_id = u.id
     ORDER BY u.created_at DESC
  `);
    res.json(rows);
  }
);

/** List sessions for a patient (include summary flag) */
router.get(
  "/patients/:patientId/sessions",
  requireAuth,
  requireRole("doctor"),
  async (req, res) => {
    const pid = Number(req.params.patientId);
    const { rows } = await pool.query(
      `
    SELECT id, status, created_at, ended_at, summary_at
      FROM care_ai.chat_sessions
     WHERE patient_id = $1
     ORDER BY created_at DESC
  `,
      [pid]
    );
    res.json(rows);
  }
);

/**
 * Get a patient's consolidated profile for the doctor.
 */
router.get(
  "/patients/:patientId/profile",
  requireAuth,
  requireRole("doctor"),
  async (req, res) => {
    const pid = Number(req.params.patientId);

    const demo = await pool.query(
      `
      SELECT u.id AS user_id,
             COALESCE(p.full_name, u.display_name, u.email) AS name,
             u.email,
             p.full_name,
             p.date_of_birth,
             p.sex,
             u.created_at
        FROM care_ai.users u
        JOIN care_ai.patients p ON p.user_id = u.id
       WHERE u.id = $1
    `,
      [pid]
    );
    if (!demo.rows.length) {
      return res.status(404).json({ error: "patient not found" });
    }

    let profileRow = null;
    try {
      const pr = await pool.query(
        `
        SELECT data, updated_at, source_session_id
          FROM care_ai.patient_profiles
         WHERE patient_id = $1
         LIMIT 1
      `,
        [pid]
      );
      profileRow = pr.rows[0] || null;
    } catch (err) {
      if (err?.code !== "42P01") {
        console.error("[doctor profile] unexpected error:", err.message || err);
      }
      profileRow = null;
    }

    res.json({
      ...demo.rows[0],
      profile: profileRow
        ? {
            data: profileRow.data || {},
            updated_at: profileRow.updated_at,
            source_session_id: profileRow.source_session_id,
          }
        : {},
    });
  }
);

/** Read messages in a session */
router.get(
  "/sessions/:sessionId/messages",
  requireAuth,
  requireRole("doctor"),
  async (req, res) => {
    const sid = Number(req.params.sessionId);
    const { rows } = await pool.query(
      `
    SELECT m.id, m.sender, m.content, m.created_at
      FROM care_ai.chat_messages m
     WHERE m.session_id = $1
     ORDER BY m.created_at ASC
  `,
      [sid]
    );
    res.json(rows);
  }
);

/** Get saved AI summary for a session */
router.get(
  "/sessions/:sessionId/summary",
  requireAuth,
  requireRole("doctor"),
  async (req, res) => {
    const sid = Number(req.params.sessionId);
    const { rows } = await pool.query(
      `
    SELECT s.id, s.patient_id, s.status, s.summary_md, s.summary_at
      FROM care_ai.chat_sessions s
     WHERE s.id = $1
  `,
      [sid]
    );
    if (!rows.length)
      return res.status(404).json({ error: "session not found" });
    res.json(rows[0]);
  }
);

/** NEW: Get doctor note for a session */
router.get(
  "/sessions/:sessionId/note",
  requireAuth,
  requireRole("doctor"),
  async (req, res) => {
    const sid = Number(req.params.sessionId);
    if (!sid) return res.status(400).json({ error: "invalid sessionId" });

    const { rows } = await pool.query(
      `
      SELECT session_id, patient_id, doctor_id, note_md, created_at, updated_at
        FROM care_ai.doctor_session_notes
       WHERE session_id = $1
       LIMIT 1
    `,
      [sid]
    );

    res.json(rows[0] || null);
  }
);

/**
 * NEW: Upsert doctor note for a session.
 * Also:
 * - extracts prescribed meds from the note (best-effort),
 * - merges meds + note into care_ai.patient_profiles.data
 */
router.post(
  "/sessions/:sessionId/note",
  requireAuth,
  requireRole("doctor"),
  async (req, res) => {
    const sid = Number(req.params.sessionId);
    const noteMd = safeText(req.body?.note_md ?? req.body?.note ?? "").trim();

    if (!sid) return res.status(400).json({ error: "invalid sessionId" });
    if (!noteMd) return res.status(400).json({ error: "note_md required" });
    if (noteMd.length > 20000)
      return res.status(400).json({ error: "note too long" });

    const patientId = await getSessionPatientId(sid);
    if (!patientId) return res.status(404).json({ error: "session not found" });

    const doctorId = req.user.sub;

    // 1) Save note per session
    const { rows } = await pool.query(
      `
      INSERT INTO care_ai.doctor_session_notes (session_id, patient_id, doctor_id, note_md)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (session_id)
      DO UPDATE SET note_md = EXCLUDED.note_md,
                    doctor_id = EXCLUDED.doctor_id,
                    updated_at = NOW()
      RETURNING session_id, patient_id, doctor_id, note_md, created_at, updated_at
    `,
      [sid, patientId, doctorId, noteMd]
    );

    const saved = rows[0];

    // 2) Extract meds from the note (best effort)
    const meds = await extractMedsFromDoctorNote(noteMd);

    // 3) Merge into patient profile (best effort)
    await upsertPatientProfileFromDoctorNote({
      patientId,
      sessionId: sid,
      doctorId,
      noteMd,
      meds,
    });

    res.json({
      ...saved,
      extracted_medications: meds || null,
    });
  }
);

module.exports = router;
