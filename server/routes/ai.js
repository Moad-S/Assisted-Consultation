// server/routes/ai.js
const express = require("express");
const router = express.Router();
const { pool } = require("../db");
const { requireAuth, requireRole } = require("../middleware/authz");

const { GoogleGenerativeAI } = require("@google/generative-ai");
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);

// Use a working model (from /api/ai/ping). Fallback is fast & cheap.
const MODEL_NAME = process.env.GEMINI_MODEL || "gemini-2.0-flash-lite";

// --- helper: verify the session belongs to the logged-in patient (no join needed)
async function verifyPatientOwnsSession(patientUserId, sessionId) {
  const { rows } = await pool.query(
    `SELECT 1
       FROM care_ai.chat_sessions
      WHERE id = $1 AND patient_id = $2
      LIMIT 1`,
    [sessionId, patientUserId]
  );
  return rows.length > 0;
}

// POST /api/ai/patient/chat/:sessionId/reply
// Body: { userText: string }
router.post(
  "/patient/chat/:sessionId/reply",
  requireAuth,
  requireRole("patient"),
  async (req, res) => {
    try {
      const sessionId = Number(req.params.sessionId);
      const { userText } = req.body || {};

      if (!sessionId || !userText || !userText.trim()) {
        return res.status(400).json({ error: "Missing sessionId or userText" });
      }

      // ensure ownership
      const owns = await verifyPatientOwnsSession(req.user.sub, sessionId);
      if (!owns) return res.status(403).json({ error: "Forbidden" });

      // load recent history (patient + ai only)
      const { rows: historyRows } = await pool.query(
        `SELECT sender, content
           FROM care_ai.chat_messages
          WHERE session_id = $1
          ORDER BY created_at ASC
          LIMIT 40`,
        [sessionId]
      );

      const history = historyRows
        .filter((m) => m.sender === "patient" || m.sender === "ai")
        .map((m) => ({
          role: m.sender === "patient" ? "user" : "model",
          parts: [{ text: m.content }],
        }));

      // talk to Gemini
      const model = genAI.getGenerativeModel({ model: MODEL_NAME });
      const chat = model.startChat({ history });

      const result = await chat.sendMessage(userText);

      // robust text extraction across SDKs
      const reply =
        result?.response?.text?.() ||
        (result?.response?.candidates?.[0]?.content?.parts || [])
          .map((p) => p.text)
          .filter(Boolean)
          .join("\n")
          .trim() ||
        "(no response)";

      // persist the AI message
      const { rows: saved } = await pool.query(
        `INSERT INTO care_ai.chat_messages (session_id, sender, content)
         VALUES ($1, 'ai', $2)
         RETURNING id, session_id, sender, content, created_at`,
        [sessionId, reply]
      );

      return res.status(201).json(saved[0]);
    } catch (err) {
      console.error("AI reply error:", err?.response?.data || err);
      return res.status(500).json({ error: "AI reply failed" });
    }
  }
);

module.exports = router;
