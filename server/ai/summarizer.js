// server/ai/summarizer.js
const { pool } = require("../db");
const { GoogleGenerativeAI } = require("@google/generative-ai");

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
const MODEL_NAME = process.env.GEMINI_MODEL || "gemini-2.0-flash-lite";

const DEFAULT_SUMMARY_PROMPT = `
You are a clinical intake summarizer. Summarize the finished patient chat for a doctor.

Rules:
- Use only info from the transcript. No diagnosis or definitive clinical claims.
- Keep it concise (≈200–300 words), in Markdown with sections:
  - **Chief concern**
  - **History of present illness**
  - **Pertinent positives/negatives** (symptoms, duration, severity)
  - **Medications/allergies** (if mentioned)
  - **Risk flags** (suicidality, chest pain, pregnancy, etc.) — write "None mentioned" if none
  - **Suggested next steps** (non-diagnostic, intake-oriented)
- If any emergency red flag appears, add a one-liner: **Triage flag: High**. Else **Triage flag: Low/Moderate**.
`;

const SUMMARY_PROMPT = (
  process.env.GEMINI_SUMMARY_PROMPT || DEFAULT_SUMMARY_PROMPT
).trim();

function clip(str, max = 32000) {
  if (!str) return "";
  return str.length > max ? str.slice(0, max) : str;
}

/**
 * Summarize a session (reads chat_messages, writes summary back to chat_sessions).
 * Returns the saved Markdown summary string.
 */
async function summarizeSession(sessionId) {
  // 1) Load full transcript (patient + ai + doctor if you want)
  const { rows: msgs } = await pool.query(
    `SELECT sender, content
       FROM care_ai.chat_messages
      WHERE session_id = $1
      ORDER BY created_at ASC`,
    [sessionId]
  );

  if (msgs.length === 0) {
    const md = "_No messages found in this session._";
    await pool.query(
      `UPDATE care_ai.chat_sessions
          SET summary_md = $2, summary_at = NOW()
        WHERE id = $1`,
      [sessionId, md]
    );
    return md;
  }

  const transcript = msgs.map((m) => `${m.sender}: ${m.content}`).join("\n");

  // 2) Call Gemini to summarize
  const model = genAI.getGenerativeModel({
    model: MODEL_NAME,
    systemInstruction: SUMMARY_PROMPT,
  });

  const result = await model.generateContent([
    {
      text:
        "Summarize the following patient conversation for a doctor in Markdown per the rules. " +
        "Transcript:\n\n" +
        clip(transcript),
    },
  ]);

  const md =
    result?.response?.text?.() ||
    result?.response?.candidates?.[0]?.content?.parts?.[0]?.text ||
    "(summary unavailable)";

  // 3) Save back to the session row
  await pool.query(
    `UPDATE care_ai.chat_sessions
        SET summary_md = $2, summary_at = NOW()
      WHERE id = $1`,
    [sessionId, md]
  );

  return md;
}

module.exports = { summarizeSession };
