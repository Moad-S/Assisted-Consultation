// server/routes/patient.js
const router = require("express").Router();
const { pool } = require("../db");
const { requireAuth, requireRole } = require("../middleware/authz");

/** Get current patient's profile (intake fields) */
router.get("/me", requireAuth, requireRole("patient"), async (req, res) => {
  const userId = req.user.sub;
  const { rows } = await pool.query(
    `
    SELECT u.id, u.email, u.display_name, p.full_name, p.date_of_birth, p.sex
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
       SET full_name = COALESCE($2, full_name),
           date_of_birth = COALESCE($3, date_of_birth),
           sex = COALESCE($4, sex)
     WHERE user_id = $1
  `,
      [userId, fullName || null, dateOfBirth || null, sex || null]
    );

    res.json({ ok: true });
  }
);

/** Helper: end any active session(s) for this patient (id optional to scope) */
async function endActiveSessionForPatient(patientId, sessionId = null) {
  const params = [patientId];
  let where = `patient_id = $1 AND status = 'active'`;
  if (sessionId) {
    params.push(sessionId);
    where += ` AND id = $2`;
  }
  // ended_at column is optional – set it if present, otherwise only flip status
  const q = `
    UPDATE care_ai.chat_sessions
       SET status = 'ended',
           ended_at = NOW()
     WHERE ${where}
     RETURNING id;
  `;
  const { rows } = await pool.query(q, params);
  return rows.map((r) => r.id);
}

/** Start a new chat session – ends any active one first */
router.post(
  "/chat/start",
  requireAuth,
  requireRole("patient"),
  async (req, res) => {
    const userId = req.user.sub;
    await endActiveSessionForPatient(userId, null);

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

/** Resume an older session (make it active) */
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

    // End any currently active session (except the one we’re resuming)
    await pool.query(
      `
      UPDATE care_ai.chat_sessions
         SET status = 'ended', ended_at = NOW()
       WHERE patient_id = $1 AND status = 'active' AND id <> $2
    `,
      [userId, sid]
    );

    // Mark the chosen session as active (clear ended_at if it exists)
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
