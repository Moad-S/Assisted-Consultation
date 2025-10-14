const router = require("express").Router();
const { pool } = require("../db");
const { requireAuth, requireRole } = require("../middleware/authz");

/** Get current patient's profile (intake fields) */
router.get("/me", requireAuth, requireRole("patient"), async (req, res) => {
  const userId = req.user.sub;
  const { rows } = await pool.query(`
    SELECT u.id, u.email, u.display_name, p.full_name, p.date_of_birth, p.sex
    FROM care_ai.users u
    JOIN care_ai.patients p ON p.user_id = u.id
    WHERE u.id = $1
  `, [userId]);
  res.json(rows[0] || {});
});

/** Save intake & optionally overwrite display_name */
router.post("/profile", requireAuth, requireRole("patient"), async (req, res) => {
  const userId = req.user.sub;
  const { fullName, dateOfBirth, sex } = req.body;

  await pool.query(
    `UPDATE care_ai.users SET display_name = COALESCE($2, display_name) WHERE id = $1`,
    [userId, fullName || null]
  );
  await pool.query(
    `UPDATE care_ai.patients
     SET full_name = COALESCE($2, full_name),
         date_of_birth = COALESCE($3, date_of_birth),
         sex = COALESCE($4, sex)
     WHERE user_id = $1`,
    [userId, fullName || null, dateOfBirth || null, sex || null]
  );
  res.json({ ok: true });
});

/** Start a new chat session */
router.post("/chat/start", requireAuth, requireRole("patient"), async (req, res) => {
  const userId = req.user.sub;
  const ins = await pool.query(
    `INSERT INTO care_ai.chat_sessions (patient_id) VALUES ($1)
     RETURNING id, status, created_at`,
    [userId]
  );
  res.status(201).json(ins.rows[0]);
});

/** Add a message to a session (patient) */
router.post("/chat/:sessionId/message", requireAuth, requireRole("patient"), async (req, res) => {
  const userId = req.user.sub;
  const sid = Number(req.params.sessionId);
  const { content } = req.body;
  if (!content) return res.status(400).json({ error: "content required" });

  // ensure session belongs to this patient
  const { rows: own } = await pool.query(
    `SELECT 1 FROM care_ai.chat_sessions WHERE id = $1 AND patient_id = $2`,
    [sid, userId]
  );
  if (!own.length) return res.status(404).json({ error: "session not found" });

  const ins = await pool.query(
    `INSERT INTO care_ai.chat_messages (session_id, sender, content)
     VALUES ($1, 'patient', $2)
     RETURNING id, session_id, sender, content, created_at`,
    [sid, content]
  );
  res.status(201).json(ins.rows[0]);
});

/** List messages for a session (patient) */
router.get("/chat/:sessionId/messages", requireAuth, requireRole("patient"), async (req, res) => {
  const userId = req.user.sub;
  const sid = Number(req.params.sessionId);

  const { rows: own } = await pool.query(
    `SELECT 1 FROM care_ai.chat_sessions WHERE id = $1 AND patient_id = $2`,
    [sid, userId]
  );
  if (!own.length) return res.status(404).json({ error: "session not found" });

  const { rows } = await pool.query(
    `SELECT id, sender, content, created_at
     FROM care_ai.chat_messages
     WHERE session_id = $1
     ORDER BY created_at ASC`,
    [sid]
  );
  res.json(rows);
});

module.exports = router;
