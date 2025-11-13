// server/routes/ai.js
const express = require("express");
const router = express.Router();
const { pool } = require("../db");
const { requireAuth, requireRole } = require("../middleware/authz");

const { GoogleGenerativeAI } = require("@google/generative-ai");

// --- Model + prompt config (backend-only) ---
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
const MODEL_NAME = process.env.GEMINI_MODEL || "gemini-2.0-flash-lite";
const ENV_SYSTEM_PROMPT = (process.env.GEMINI_SYSTEM_PROMPT || "").trim();

// Ensure session belongs to this patient and is active
async function getOwnedSession(patientUserId, sessionId) {
  const { rows } = await pool.query(
    `SELECT id, status
       FROM care_ai.chat_sessions
      WHERE id = $1 AND patient_id = $2`,
    [sessionId, patientUserId]
  );
  return rows[0] || null;
}

/**
 * Very light safety pass:
 * - Strips any lines that look like *recommendations* for imaging/meds.
 * - We only remove declarative advice (not questions).
 * - This keeps intake chat strictly history-gathering.
 */
function stripAdvice(markdown = "") {
  const lines = String(markdown).split("\n");
  const cleaned = [];

  for (let raw of lines) {
    const line = raw.trim();
    const lower = line.toLowerCase();

    // keep blank spacing
    if (!line) {
      cleaned.push(raw);
      continue;
    }

    // quick exits for headings/bullets that are clearly summary-only phrases
    const bannedHeadings = [
      "**possible tests",
      "**imaging to discuss",
      "**medication considerations",
      "imaging:",
      "imaging to discuss:",
    ];
    if (bannedHeadings.some((h) => lower.startsWith(h))) continue;

    // we consider it "advice" if it's *not a question* and includes a recommender verb
    const hasRecommender =
      /(recommend|suggest|should|consider|start|begin|take|use|get|need|prescrib|dose)\b/i.test(
        line
      ) && !line.endsWith("?");

    // only strip if that advice concerns imaging/medication classes explicitly
    const targets =
      /(x-?ray|ct\b|mri\b|ultrasound|scan|imaging|antibiotic|antivir|steroid|ibuprofen|naproxen|acetaminophen|paracetamol|amoxicillin|dose|mg\b)/i.test(
        line
      );

    if (hasRecommender && targets) {
      // drop this line
      continue;
    }

    cleaned.push(raw);
  }

  const out = cleaned.join("\n").trim();
  return out.length
    ? out
    : "Thanks for the information. I’ll pass this to the doctor.";
}

// POST /api/ai/patient/chat/:sessionId/reply
// Body: { userText: string }  <-- no systemPrompt here; backend-only
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

      // Ownership + active check
      const owned = await getOwnedSession(req.user.sub, sessionId);
      if (!owned) return res.status(404).json({ error: "Session not found" });
      if (owned.status && owned.status !== "active") {
        return res.status(400).json({ error: "Session is not active" });
      }

      // Load short history (patient + ai only)
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

      // Build model with backend-only system instruction
      const systemInstruction =
        ENV_SYSTEM_PROMPT.length > 0 ? ENV_SYSTEM_PROMPT : undefined;

      const model = genAI.getGenerativeModel(
        systemInstruction
          ? { model: MODEL_NAME, systemInstruction }
          : { model: MODEL_NAME }
      );

      // Fallback for older SDKs: inject a pseudo system message up front
      const historyForChat =
        systemInstruction && systemInstruction.length > 0
          ? [
              {
                role: "user",
                parts: [{ text: `SYSTEM PROMPT:\n${systemInstruction}` }],
              },
              ...history,
            ]
          : history;

      const chat = model.startChat({ history: historyForChat });

      // Send latest user message
      const result = await chat.sendMessage(userText);

      // Robust text extraction across SDK versions
      const rawReply =
        result?.response?.text?.() ||
        result?.response?.candidates?.[0]?.content?.parts?.[0]?.text ||
        "(no response)";

      // Enforce "intake-only" in the patient chat
      const reply = stripAdvice(rawReply);

      // Save AI reply
      const { rows: saved } = await pool.query(
        `INSERT INTO care_ai.chat_messages (session_id, sender, content)
         VALUES ($1, 'ai', $2)
         RETURNING id, session_id, sender, content, created_at`,
        [sessionId, reply]
      );

      return res.status(201).json(saved[0]);
    } catch (err) {
      console.error("AI reply error:", err);
      return res.status(500).json({ error: "AI reply failed" });
    }
  }
);

module.exports = router;
