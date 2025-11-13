// server/ai/summarizer.js
const { pool } = require("../db");
const { GoogleGenerativeAI } = require("@google/generative-ai");

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
const MODEL_NAME = process.env.GEMINI_MODEL || "gemini-2.0-flash-lite";

const DEFAULT_SUMMARY_PROMPT = `
You are a clinical intake summarizer. Summarize the finished patient chat for a doctor.
Use only information from the transcript. Do not diagnose or assert facts not stated.

Write **200–300 words** in Markdown with these bolded sections:

- **Chief concern**
- **History of present illness** (onset, location, character, severity, timing, radiation, triggers/relievers, associated symptoms)
- **Pertinent positives/negatives** (concise bullets)
- **Past medical/surgical history** — write **Not asked / not documented** if absent
- **Medications / Allergies** — write **Not asked / not documented** if absent
- **Social history** (tobacco, alcohol, recreational drugs; occupation/activity; pregnancy status if relevant) — write **Not asked / not documented** if absent
- **Family history** — **Not asked / not documented** if absent
- **Risk flags** (present red flags; else “None mentioned”)
- **Suggested next steps** (non-diagnostic, intake-oriented)

**Clinician suggestions (not shown to patient):**
- **Imaging/tests to consider:** choose at most one modality with a one-line rationale, using these heuristics only when supported by the history:
  - Focal bony tenderness/deformity after trauma → **X-ray**.
  - Suspected tendon/ligament tear → **Ultrasound** (then **MRI** if needed).
  - New neuro deficit, severe/worsening headache, or head trauma with red flags/anticoagulants → **CT head (non-contrast)**.
  - Back pain with red flags (fever, cancer history, neuro deficits, saddle anesthesia, bladder/bowel issues) → **MRI spine**.
  - Persistent fever + productive cough → **Chest X-ray**.
  - Classic renal colic → **Non-contrast CT KUB** (or **ultrasound** if pregnant).
  - Unilateral leg swelling/pain suspicious for DVT → **Venous Doppler ultrasound**.
  - Acute RLQ pain suspicious for appendicitis → **CT abdomen/pelvis** (or **ultrasound** in pregnancy/pediatrics).
  - Prefer **ultrasound** as first-line in pregnancy.
  - If none clearly apply, write **None indicated**.
- **Medication considerations (for clinician):** optional 1–2 bullets naming classes only (no doses). Examples:
  - **Analgesia:** acetaminophen; NSAIDs if no renal disease/PUD/anticoagulation; avoid in pregnancy unless clinician-judged appropriate.
  - **Avoid** antibiotics or steroids unless the clinical picture clearly supports it.
  If not appropriate, write **None indicated**.

If any emergency red flag appears, add:
**Triage flag:** High.
Otherwise: **Triage flag:** Low/Moderate.
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
