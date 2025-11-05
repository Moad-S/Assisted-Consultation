// server/routes/doctor.js
const router = require("express").Router();
const { pool } = require("../db");
const { requireAuth, requireRole } = require("../middleware/authz");

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

/** ⬇️ NEW: Get saved AI summary for a session */
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

module.exports = router;
