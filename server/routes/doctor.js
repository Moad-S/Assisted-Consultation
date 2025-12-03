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

/**
 * NEW: Get a patient's consolidated profile for the doctor.
 * - Always returns demographics from users/patients.
 * - If AI profile exists (care_ai.patient_profiles), returns it under "profile".
 * - If table is missing or no row yet, returns profile: {} (safe).
 */
router.get(
  "/patients/:patientId/profile",
  requireAuth,
  requireRole("doctor"),
  async (req, res) => {
    const pid = Number(req.params.patientId);

    // Demographics / intake base
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

    // Optional AI-extracted profile
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
      // If the table doesn't exist yet, fail soft (return empty profile).
      // Postgres undefined_table error code: 42P01
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
        : {}, // safe default
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

module.exports = router;
