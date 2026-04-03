// server/routes/patient.js
const router = require("express").Router();
const { pool } = require("../db");
const { requireAuth, requireRole } = require("../middleware/authz");

// ------------------------- Background summarizer (already in your app) -------------------------
let summarizeSession = null;
try {
  ({ summarizeSession } = require("../ai/summarizer"));
} catch {
  summarizeSession = null; // not fatal
}

// ------------------------- Optional AI profile extractor (safe if missing) ----------------------
let genAI = null;
let MODEL_NAME = process.env.GEMINI_MODEL || "gemini-2.0-flash-lite";
try {
  if (process.env.GOOGLE_API_KEY) {
    const { GoogleGenerativeAI } = require("@google/generative-ai");
    genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
  }
} catch {
  genAI = null;
}

const PROFILE_JSON_PROMPT = String.raw`
You are an intake information extractor. From the following patient/AI chat transcript,
return a single JSON object matching this EXACT schema (no extra keys, no comments):

{
  "chronic_conditions": [ "string" ],
  "allergies": [ "string" ],
  "current_medications": [ "string" ],
  "past_medical_history": [ "string" ],
  "past_surgical_history": [ "string" ],
  "family_history": [ "string" ],
  "social_history": {
    "smoking": "yes|no|former|unknown",
    "alcohol": "yes|no|unknown",
    "drugs": "yes|no|unknown"
  },
  "pregnancy_status": "pregnant|not_pregnant|unknown"
}

Rules:
- Use only information explicitly present in the transcript.
- If a field is not mentioned, use [] for arrays or "unknown" for categorical fields.
- Do NOT diagnose or infer anything. No free-text outside the JSON.
`;

function tryJsonParse(s) {
  if (!s) return null;
  const cleaned = String(s)
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}

async function upsertProfileFromSession(sessionId) {
  // Soft-fail if AI is not configured
  if (!genAI) return;

  try {
    // Transcript
    const { rows: msgs } = await pool.query(
      `
      SELECT sender, content
        FROM care_ai.chat_messages
       WHERE session_id = $1
       ORDER BY created_at ASC
    `,
      [sessionId]
    );

    if (!msgs.length) return;

    const transcript = msgs
      .map((m) => `${m.sender}: ${m.content}`)
      .join("\n")
      .slice(-10000); // bound prompt size

    // Session owner (patient_id)
    const { rows: srows } = await pool.query(
      `SELECT patient_id FROM care_ai.chat_sessions WHERE id = $1`,
      [sessionId]
    );
    if (!srows.length) return;
    const patientId = srows[0].patient_id;

    // Ask Gemini
    const model = genAI.getGenerativeModel({ model: MODEL_NAME });
    const resp = await model.generateContent([
      { text: PROFILE_JSON_PROMPT },
      { text: `TRANSCRIPT:\n${transcript}` },
    ]);

    const text =
      resp?.response?.text?.() ||
      resp?.response?.candidates?.[0]?.content?.parts?.[0]?.text ||
      null;

    const extracted = tryJsonParse(text);
    if (!extracted) return;

    // Merge (upsert). If table doesn't exist, catch & log without crashing.
    await pool.query(
      `
      INSERT INTO care_ai.patient_profiles (patient_id, data, source_session_id)
      VALUES ($1, $2::jsonb, $3)
      ON CONFLICT (patient_id)
      DO UPDATE SET
        data = care_ai.patient_profiles.data || EXCLUDED.data,
        source_session_id = EXCLUDED.source_session_id,
        updated_at = NOW()
    `,
      [patientId, JSON.stringify(extracted), sessionId]
    );
  } catch (err) {
    console.error("[profile-extract] non-fatal error:", err.message || err);
  }
}

// -------------------------------- Existing endpoints (unchanged behavior) ----------------------

/** Get current patient's profile (intake fields) */
router.get("/me", requireAuth, requireRole("patient"), async (req, res) => {
  const userId = req.user.sub;
  const { rows } = await pool.query(
    `
    SELECT u.id, u.email, u.display_name, u.display_name AS full_name, p.date_of_birth AS date_of_birth, p.sex
      FROM care_ai.users u
      JOIN care_ai.patients p ON p.user_id = u.id
     WHERE u.id = $1
  `,
    [userId]
  );
  res.json(rows[0] || {});
});

/** Save intake & optionally overwrite display_name */
router.post(
  "/profile",
  requireAuth,
  requireRole("patient"),
  async (req, res) => {
    const userId = req.user.sub;
    const { fullName, dateOfBirth, sex } = req.body || {};

    await pool.query(
      `UPDATE care_ai.users SET display_name = COALESCE($2, display_name) WHERE id = $1`,
      [userId, fullName || null]
    );

    await pool.query(
      `
    UPDATE care_ai.patients
       SET date_of_birth = COALESCE($3, date_of_birth),
           sex        = COALESCE($4, sex)
     WHERE user_id = $1
  `,
      [userId, fullName || null, dateOfBirth || null, sex || null]
    );

    res.json({ ok: true });
  }
);

/**
 * Helper: end any active session(s) for this patient.
 * If sessionId is provided, scope to that row.
 * Returns the list of ended session IDs.
 * Also triggers background summarization & profile extraction for each ended session.
 */
async function endActiveSessionForPatient(patientId, sessionId = null) {
  const params = [patientId];
  let where = `patient_id = $1 AND status = 'active'`;
  if (sessionId) {
    params.push(sessionId);
    where += ` AND id = $2`;
  }

  const q = `
    UPDATE care_ai.chat_sessions
       SET status = 'ended',
           ended_at = NOW()
     WHERE ${where}
     RETURNING id;
  `;
  const { rows } = await pool.query(q, params);
  const endedIds = rows.map((r) => r.id);

  // Fire-and-forget: summarization + profile extraction
  if (endedIds.length) {
    for (const sid of endedIds) {
      if (summarizeSession) {
        setImmediate(() =>
          summarizeSession(sid).catch((e) =>
            console.error("[summarize] failed for sid", sid, e)
          )
        );
      }
      setImmediate(() =>
        upsertProfileFromSession(sid).catch((e) =>
          console.error("[profile-extract] failed for sid", sid, e)
        )
      );
    }
  }

  return endedIds;
}

/** Start a new chat session – ends any active one first */
router.post(
  "/chat/start",
  requireAuth,
  requireRole("patient"),
  async (req, res) => {
    const userId = req.user.sub;

    // End any current active sessions (and summarize/extract in background)
    await endActiveSessionForPatient(userId, null);

    // Create a new active session
    const ins = await pool.query(
      `
    INSERT INTO care_ai.chat_sessions (patient_id, status)
         VALUES ($1, 'active')
      RETURNING id, status, created_at, ended_at
  `,
      [userId]
    );
    res.status(201).json(ins.rows[0]);
  }
);

/** End current (or given) session */
router.post(
  "/chat/end",
  requireAuth,
  requireRole("patient"),
  async (req, res) => {
    const userId = req.user.sub;
    const { sessionId } = req.body || {};
    const ended = await endActiveSessionForPatient(userId, sessionId || null);
    if (!ended.length)
      return res.status(404).json({ error: "No active session to end" });
    res.json({ ok: true, ended });
  }
);

/** Get the active session id (or null) */
router.get(
  "/chat/active",
  requireAuth,
  requireRole("patient"),
  async (req, res) => {
    const userId = req.user.sub;
    const { rows } = await pool.query(
      `
    SELECT id
      FROM care_ai.chat_sessions
     WHERE patient_id = $1 AND status = 'active'
     ORDER BY created_at DESC
     LIMIT 1
  `,
      [userId]
    );
    res.json({ id: rows[0]?.id || null });
  }
);

/** List recent sessions (active + ended) */
router.get(
  "/chat/history",
  requireAuth,
  requireRole("patient"),
  async (req, res) => {
    const userId = req.user.sub;
    const limit = Math.max(1, Math.min(100, Number(req.query.limit) || 20));
    const { rows } = await pool.query(
      `
    SELECT id, status, created_at, ended_at
      FROM care_ai.chat_sessions
     WHERE patient_id = $1
     ORDER BY created_at DESC
     LIMIT $2
  `,
      [userId, limit]
    );
    res.json(rows);
  }
);

/**
 * Resume an older session (make it active again).
 */
router.post(
  "/chat/:sessionId/resume",
  requireAuth,
  requireRole("patient"),
  async (req, res) => {
    const userId = req.user.sub;
    const sid = Number(req.params.sessionId);
    if (!sid) return res.status(400).json({ error: "Invalid sessionId" });

    // Verify the session belongs to the patient
    const { rows: own } = await pool.query(
      `SELECT 1 FROM care_ai.chat_sessions WHERE id = $1 AND patient_id = $2`,
      [sid, userId]
    );
    if (!own.length)
      return res.status(404).json({ error: "Session not found" });

    // End any currently active session (except the one we’re activating)
    await pool.query(
      `
      UPDATE care_ai.chat_sessions
         SET status = 'ended', ended_at = NOW()
       WHERE patient_id = $1 AND status = 'active' AND id <> $2
    `,
      [userId, sid]
    );

    // Mark the chosen session as active (clear ended_at if present)
    const { rows } = await pool.query(
      `
      UPDATE care_ai.chat_sessions
         SET status = 'active', ended_at = NULL
       WHERE id = $1 AND patient_id = $2
       RETURNING id, status, created_at, ended_at
    `,
      [sid, userId]
    );

    res.json(rows[0]);
  }
);

/** Add a message to a session (patient) */
router.post(
  "/chat/:sessionId/message",
  requireAuth,
  requireRole("patient"),
  async (req, res) => {
    const userId = req.user.sub;
    const sid = Number(req.params.sessionId);
    const { content } = req.body || {};
    if (!sid || !content)
      return res.status(400).json({ error: "content required" });

    // ensure session belongs to this patient
    const { rows: own } = await pool.query(
      `SELECT 1 FROM care_ai.chat_sessions WHERE id = $1 AND patient_id = $2`,
      [sid, userId]
    );
    if (!own.length)
      return res.status(404).json({ error: "session not found" });

    const ins = await pool.query(
      `
      INSERT INTO care_ai.chat_messages (session_id, sender, content)
           VALUES ($1, 'patient', $2)
        RETURNING id, session_id, sender, content, created_at
    `,
      [sid, content]
    );
    res.status(201).json(ins.rows[0]);
  }
);

/** List messages for a session (patient) */
router.get(
  "/chat/:sessionId/messages",
  requireAuth,
  requireRole("patient"),
  async (req, res) => {
    const userId = req.user.sub;
    const sid = Number(req.params.sessionId);

    const { rows: own } = await pool.query(
      `SELECT 1 FROM care_ai.chat_sessions WHERE id = $1 AND patient_id = $2`,
      [sid, userId]
    );
    if (!own.length)
      return res.status(404).json({ error: "session not found" });

    const { rows } = await pool.query(
      `
      SELECT id, sender, content, created_at
        FROM care_ai.chat_messages
       WHERE session_id = $1
       ORDER BY created_at ASC
    `,
      [sid]
    );
    res.json(rows);
  }
);

module.exports = router;
