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

/**
 * NEW: Profile extraction prompt (strict JSON).
 * This updates care_ai.patient_profiles AFTER each ended session.
 */
const DEFAULT_PROFILE_PROMPT = `
You are an EHR profile extractor. From the transcript, extract ONLY new or confirmed patient profile facts.
Do NOT infer. If not explicitly stated, use null (or "unknown" for smoking/alcohol/drugs).

Return STRICT JSON ONLY with this exact shape:

{
  "chronic_conditions": string[] | null,
  "past_surgical_history": string[] | null,
  "medications": string[] | null,
  "allergies": string[] | null,
  "social_history": string | null,
  "family_history": string[] | null,
  "substance_use": {
    "smoking": "yes" | "no" | "unknown",
    "alcohol": "yes" | "no" | "unknown",
    "drugs": "yes" | "no" | "unknown"
  } | null,
  "other_notes": string | null
}

Rules:
- Only include items explicitly mentioned in the transcript.
- Prefer clean strings (e.g., "Xanax (alprazolam)", "penicillin allergy").
- If patient stopped a medication, include it but indicate status (e.g., "antidepressants (stopped)").
- If nothing new is present, return JSON with all fields null and substance_use null.
`;

const PROFILE_PROMPT = (
  process.env.GEMINI_PROFILE_PROMPT || DEFAULT_PROFILE_PROMPT
).trim();

function clip(str, max = 32000) {
  if (!str) return "";
  return str.length > max ? str.slice(0, max) : str;
}

/** ------------------------- profile merge helpers ------------------------- */

function safeText(x) {
  return String(x == null ? "" : x);
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

function isUsefulString(s) {
  return typeof s === "string" && s.trim().length > 0;
}

function mergeSubstanceUse(existing, incoming) {
  if (!incoming) return existing || null;
  const out = { ...(existing || {}) };

  for (const k of ["smoking", "alcohol", "drugs"]) {
    const iv = incoming[k];
    if (!iv) continue;

    // do not overwrite known with unknown
    if (iv === "unknown") {
      if (!out[k]) out[k] = "unknown";
      continue;
    }
    out[k] = iv;
  }

  // ensure keys exist if we have any substance_use at all
  for (const k of ["smoking", "alcohol", "drugs"]) {
    if (!out[k]) out[k] = "unknown";
  }

  return out;
}

function mergeProfile(existingData, updateData) {
  const existing =
    existingData && typeof existingData === "object" ? existingData : {};
  const upd = updateData && typeof updateData === "object" ? updateData : {};

  const merged = { ...existing };

  // list fields: union + dedupe
  for (const key of [
    "chronic_conditions",
    "past_surgical_history",
    "medications",
    "allergies",
    "family_history",
  ]) {
    const a = normalizeList(existing[key]);
    const b = normalizeList(upd[key]);
    const combined = dedupePreserve([...a, ...b]);
    if (combined.length) merged[key] = combined;
  }

  // strings: prefer the new one if it exists (but never set to empty)
  if (isUsefulString(upd.social_history))
    merged.social_history = upd.social_history;
  if (isUsefulString(upd.other_notes)) merged.other_notes = upd.other_notes;

  // substance_use
  if (upd.substance_use || existing.substance_use) {
    merged.substance_use = mergeSubstanceUse(
      existing.substance_use,
      upd.substance_use
    );
  }

  return merged;
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

function profileHasAny(update) {
  if (!update || typeof update !== "object") return false;
  return (
    normalizeList(update.chronic_conditions).length ||
    normalizeList(update.past_surgical_history).length ||
    normalizeList(update.medications).length ||
    normalizeList(update.allergies).length ||
    normalizeList(update.family_history).length ||
    isUsefulString(update.social_history) ||
    isUsefulString(update.other_notes) ||
    !!update.substance_use
  );
}

/**
 * NEW: Extract profile updates from transcript using Gemini
 */
async function extractProfileUpdateFromTranscript(transcript) {
  const model = genAI.getGenerativeModel({
    model: MODEL_NAME,
    systemInstruction: PROFILE_PROMPT,
  });

  const result = await model.generateContent([
    {
      text:
        "Extract patient profile updates as STRICT JSON ONLY, following the exact schema. " +
        "Transcript:\n\n" +
        clip(transcript),
    },
  ]);

  const raw =
    result?.response?.text?.() ||
    result?.response?.candidates?.[0]?.content?.parts?.[0]?.text ||
    "";

  const parsed = extractFirstJsonObject(raw);
  if (!parsed) return null;
  if (!profileHasAny(parsed)) return null;
  return parsed;
}

/**
 * NEW: Upsert profile data into care_ai.patient_profiles
 * Merges with existing JSON to avoid losing info.
 */
async function upsertPatientProfile(patientId, sourceSessionId, updateObj) {
  // patient_profiles might not exist yet; fail safely
  let existing = {};
  try {
    const { rows } = await pool.query(
      `SELECT data
         FROM care_ai.patient_profiles
        WHERE patient_id = $1
        LIMIT 1`,
      [patientId]
    );
    existing = (rows[0] && rows[0].data) || {};
  } catch (e) {
    console.warn(
      "[profile] patient_profiles table missing or read failed:",
      e?.message || e
    );
    return;
  }

  const merged = mergeProfile(existing, updateObj);

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
      [patientId, merged, sourceSessionId]
    );
  } catch (e) {
    console.warn("[profile] upsert failed:", e?.message || e);
  }
}

/**
 * Summarize a session (reads chat_messages, writes summary back to chat_sessions).
 * Returns the saved Markdown summary string.
 */
async function summarizeSession(sessionId) {
  // 0) get patient_id (needed for profile updates)
  const { rows: sessRows } = await pool.query(
    `SELECT id, patient_id
       FROM care_ai.chat_sessions
      WHERE id = $1
      LIMIT 1`,
    [sessionId]
  );
  const patientId = sessRows[0]?.patient_id || null;

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

  // 2) Call Gemini to summarize (existing behavior preserved)
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

  // 3) Save back to the session row (existing behavior preserved)
  await pool.query(
    `UPDATE care_ai.chat_sessions
        SET summary_md = $2, summary_at = NOW()
      WHERE id = $1`,
    [sessionId, md]
  );

  // 4) NEW: extract + upsert patient profile updates (non-blocking best effort)
  // If anything fails here, we should NOT break summarization.
  if (patientId) {
    try {
      const update = await extractProfileUpdateFromTranscript(transcript);
      if (update) {
        await upsertPatientProfile(patientId, sessionId, update);
      }
    } catch (e) {
      console.warn("[profile] extraction/upsert failed:", e?.message || e);
    }
  }

  return md;
}

module.exports = { summarizeSession };
