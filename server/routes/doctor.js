// server/routes/doctor.js
const router = require("express").Router();
const { pool } = require("../db");
const { requireAuth, requireRole } = require("../middleware/authz");

const { GoogleGenerativeAI } = require("@google/generative-ai");
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
const MODEL_NAME = process.env.GEMINI_MODEL || "gemini-2.0-flash-lite";

/** ---------------- AI prompt (doctor note -> profile patch) ---------------- */

const DEFAULT_NOTE_PROFILE_EXTRACT_PROMPT = `
You extract structured patient-profile facts ONLY from a doctor's note.

Return STRICT JSON ONLY (no markdown, no commentary) with EXACTLY this shape:
{
  "chronic_conditions": string[] | null,
  "past_surgical_history": string[] | null,

  "medications": string[] | null,
  "doctor_prescriptions": string[] | null,

  "allergies": string[] | null,
  "social_history": string[] | null,
  "family_history": string[] | null,
  "substance_use": { "alcohol": string | null, "smoking": string | null, "drugs": string | null } | null,
  "other_notes": string[] | null
}

Rules:
- Use ONLY what is explicitly stated in the note. Do NOT invent.
- Write short canonical items (NOT full sentences).

- medications:
  - ONLY what the PATIENT is taking (e.g., "Insulin", "Antidepressants"), ONLY if explicitly stated as current meds.
  - Do NOT include prescriptions/recommendations here.
  - Do NOT include durations here.

- doctor_prescriptions:
  - ONLY meds the clinician is prescribing/recommending or explicitly discontinuing.
  - Keep dose/route/frequency if present, in the same string.
  - If duration IS present, format it neatly at the END as: " (3 days)" or " (2 months)".
    Examples:
    - "antacid for 3 days" -> "Antacid (3 days)"
    - "simethicone for the duration of two days" -> "Simethicone (2 days)"
    - "Paracetamol 500mg PO TID x 7 days" -> "Paracetamol 500mg PO TID (7 days)"
  - If duration is NOT mentioned, output just the medication name (and dose/route/frequency if present).
  - Do NOT add "(duration not specified)".
  - If stopping a med is explicitly instructed, use: "DISCONTINUE: <med>" (and duration if explicitly stated).

- allergies: output clean allergy names like "Peanut allergy", "Penicillin allergy" (not full sentences).
- social_history: job/activity/living situation etc. Do NOT include smoking/alcohol/drugs here.
- family_history: output the condition name only, e.g. "Heart disease", "Cancer", "Diabetes".
- substance_use: normalize to "yes" | "no" | "unknown" | "addiction" when possible.
- If a field is not mentioned, return null for that field.
- JSON only. No code fences.
`;

const NOTE_PROFILE_EXTRACT_PROMPT = (
  process.env.GEMINI_NOTE_PROFILE_EXTRACT_PROMPT ||
  DEFAULT_NOTE_PROFILE_EXTRACT_PROMPT
).trim();

/** ---------------- Small utilities ---------------- */

function safeText(x) {
  return String(x == null ? "" : x);
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
  for (const item of arr || []) {
    const t = safeText(item).trim();
    if (!t) continue;
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}

function normalizeYesNoUnknown(v) {
  if (!v) return null;
  const t = safeText(v).trim().toLowerCase();
  if (!t) return null;
  if (t.includes("addict")) return "addiction";
  if (["yes", "y", "true", "uses", "drinks", "smokes"].includes(t))
    return "yes";
  if (["no", "n", "false", "denies", "none"].includes(t)) return "no";
  if (["unknown", "unk"].includes(t)) return "unknown";
  return t;
}

function isUnknownLike(s) {
  const t = safeText(s).trim().toLowerCase();
  return !t || t === "unknown" || t === "not asked" || t === "not documented";
}

/** ---------------- Canonicalization for neat profile ---------------- */

function stripLeadingArticles(s) {
  return safeText(s)
    .trim()
    .replace(/^(a|an|the)\s+/i, "")
    .trim();
}

function titleCaseFirst(s) {
  const t = safeText(s).trim();
  if (!t) return "";
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function canonicalizeAllergy(s) {
  let t = stripLeadingArticles(s);
  t = t.replace(/[.,;:]+$/g, "").trim();
  t = t.replace(/\s+/g, " ").trim();
  if (!t) return "";

  if (!/\ballergy\b/i.test(t)) t = `${t} allergy`;
  t = t.replace(/\ballergy\s+allergy\b/i, "allergy").trim();

  return titleCaseFirst(t);
}

function wordToNumberMaybe(w) {
  const m = {
    one: 1,
    two: 2,
    three: 3,
    four: 4,
    five: 5,
    six: 6,
    seven: 7,
    eight: 8,
    nine: 9,
    ten: 10,
  };
  const key = safeText(w).trim().toLowerCase();
  return m[key] != null ? String(m[key]) : null;
}

function pluralizeUnit(nStr, unit) {
  const n = Number(nStr);
  const u = safeText(unit).toLowerCase();
  if (!n || n === 1) return u;
  return u.endsWith("s") ? u : `${u}s`;
}

/**
 * Canonicalize a prescription string with duration -> "(N unit[s])" at the end.
 * Keeps dose/route/frequency if present.
 */
function canonicalizePrescription(s) {
  let t = stripLeadingArticles(s);
  t = t.replace(/[.,;:]+$/g, "").trim();
  t = t.replace(/\s+/g, " ").trim();
  if (!t) return "";

  // If already ends with "(N unit)" normalize pluralization
  t = t.replace(
    /\(\s*(\d+)\s*(day|week|month|year)s?\s*\)\s*$/i,
    (_m, n, unit) => `(${n} ${pluralizeUnit(n, unit)})`
  );

  const hasParenDuration = /\(\s*\d+\s*(day|week|month|year)s?\s*\)\s*$/i.test(
    t
  );

  if (!hasParenDuration) {
    // x 7 days / x7 days / × 7 days
    t = t.replace(
      /\s*(?:x|×)\s*(\d+)\s*(day|week|month|year)s?\s*$/i,
      (_m, n, unit) => ` (${n} ${pluralizeUnit(n, unit)})`
    );

    // for 7 days
    t = t.replace(
      /\s*for\s+(\d+)\s*(day|week|month|year)s?\s*$/i,
      (_m, n, unit) => ` (${n} ${pluralizeUnit(n, unit)})`
    );

    // for the duration of two days
    t = t.replace(
      /\s*for\s+the\s+duration\s+of\s+([a-z]+)\s*(day|week|month|year)s?\s*$/i,
      (_m, wordNum, unit) => {
        const n = wordToNumberMaybe(wordNum);
        return n
          ? ` (${n} ${pluralizeUnit(n, unit)})`
          : ` (${wordNum} ${unit})`;
      }
    );

    // duration of 7 days
    t = t.replace(
      /\s*(?:duration\s+of)\s+(\d+)\s*(day|week|month|year)s?\s*$/i,
      (_m, n, unit) => ` (${n} ${pluralizeUnit(n, unit)})`
    );
  }

  t = t.replace(/\)\s*\(/g, ") (").trim();
  t = t.replace(/\s+/g, " ").trim();

  return titleCaseFirst(t);
}

/**
 * Patient meds list should be clean and typically without duration.
 * If AI mistakenly includes duration, strip it.
 */
function canonicalizePatientMedication(s) {
  let t = stripLeadingArticles(s);
  t = t.replace(/[.,;:]+$/g, "").trim();
  t = t.replace(/\s+/g, " ").trim();
  if (!t) return "";

  // strip trailing duration formats
  t = t.replace(/\(\s*\d+\s*(day|week|month|year)s?\s*\)\s*$/i, "").trim();
  t = t.replace(/\s*(?:x|×)\s*\d+\s*(day|week|month|year)s?\s*$/i, "").trim();
  t = t.replace(/\s*for\s+\d+\s*(day|week|month|year)s?\s*$/i, "").trim();
  t = t
    .replace(
      /\s*for\s+the\s+duration\s+of\s+[a-z]+\s*(day|week|month|year)s?\s*$/i,
      ""
    )
    .trim();
  t = t
    .replace(/\s*(?:duration\s+of)\s+\d+\s*(day|week|month|year)s?\s*$/i, "")
    .trim();

  t = t.replace(/\s+/g, " ").trim();
  return titleCaseFirst(t);
}

function canonicalizeFamilyHistoryItem(s) {
  let t = stripLeadingArticles(s);
  t = t.replace(/[.,;:]+$/g, "").trim();
  t = t.replace(/\s+/g, " ").trim();
  if (!t) return "";

  t = t.replace(/^family history of\s+/i, "").trim();
  t = t.replace(/^fhx\s+of\s+/i, "").trim();

  return titleCaseFirst(t);
}

function canonicalizeSocialHistoryItem(s) {
  let t = stripLeadingArticles(s);
  t = t.replace(/[.,;:]+$/g, "").trim();
  t = t.replace(/\s+/g, " ").trim();
  if (!t) return "";

  if (
    /\b(smok|tobacco|cigarette|alcohol|drink|drugs?|cannabis|marijuana|opioid|cocaine)\b/i.test(
      t
    )
  ) {
    return "";
  }

  return t;
}

function normalizeSubstanceUse(existingObj, patchObj) {
  const out = {
    ...(existingObj && typeof existingObj === "object" ? existingObj : {}),
  };
  const patch = patchObj && typeof patchObj === "object" ? patchObj : null;
  if (!patch) return out;

  for (const k of ["alcohol", "smoking", "drugs"]) {
    const cur = normalizeYesNoUnknown(out[k]);
    const inc = normalizeYesNoUnknown(patch[k]);
    if (!inc) continue;

    if (inc === "addiction") {
      out[k] = "addiction";
      continue;
    }

    if (!cur || cur === "unknown") {
      out[k] = inc;
      continue;
    }

    if (cur !== inc && cur === "no" && inc === "yes") {
      out[k] = "yes";
      continue;
    }
  }

  return out;
}

function isPrescriptionLikeItem(s) {
  const t = safeText(s).trim();
  if (!t) return false;
  if (/^discontinue\s*:/i.test(t)) return true;
  if (/\(\s*\d+\s*(day|week|month|year)s?\s*\)\s*$/i.test(t)) return true;
  if (/\b(?:x|×)\s*\d+\s*(day|week|month|year)s?\s*$/i.test(t)) return true;
  if (/\bfor\s+\d+\s*(day|week|month|year)s?\s*$/i.test(t)) return true;
  if (
    /\bfor\s+the\s+duration\s+of\s+[a-z]+\s*(day|week|month|year)s?\s*$/i.test(
      t
    )
  )
    return true;
  if (/\bduration\s+of\s+\d+\s*(day|week|month|year)s?\s*$/i.test(t))
    return true;
  return false;
}

/** ---------------- Patch safety net (prevents bad types / duplication) ---------------- */

function sanitizeProfilePatch(patch) {
  if (!patch || typeof patch !== "object") return null;

  const out = {};

  const listFields = [
    "chronic_conditions",
    "past_surgical_history",
    "medications",
    "doctor_prescriptions",
    "allergies",
    "social_history",
    "family_history",
    "other_notes",
  ];

  for (const f of listFields) {
    const v = patch[f];
    if (v == null) {
      out[f] = null;
      continue;
    }
    if (Array.isArray(v)) {
      out[f] = v.map((x) => safeText(x).trim()).filter(Boolean);
      continue;
    }
    if (typeof v === "string") {
      const t = v.trim();
      out[f] = t ? [t] : null;
      continue;
    }
    out[f] = null;
  }

  if (patch.substance_use && typeof patch.substance_use === "object") {
    out.substance_use = {
      alcohol: patch.substance_use.alcohol ?? null,
      smoking: patch.substance_use.smoking ?? null,
      drugs: patch.substance_use.drugs ?? null,
    };
  } else {
    out.substance_use = null;
  }

  for (const f of listFields) {
    if (Array.isArray(out[f]) && out[f].length === 0) out[f] = null;
  }

  return out;
}

/** ---------------- DB helpers ---------------- */

async function getSessionPatientId(sessionId) {
  const { rows } = await pool.query(
    `SELECT patient_id FROM care_ai.chat_sessions WHERE id = $1 LIMIT 1`,
    [sessionId]
  );
  return rows[0]?.patient_id || null;
}

async function readExistingProfileData(patientId) {
  try {
    const { rows } = await pool.query(
      `SELECT data FROM care_ai.patient_profiles WHERE patient_id = $1 LIMIT 1`,
      [patientId]
    );
    return (rows[0] && rows[0].data) || {};
  } catch (err) {
    if (err?.code !== "42P01") {
      console.error("[doctor note] profile read error:", err.message || err);
    }
    return null;
  }
}

async function upsertProfileData(patientId, sessionId, merged) {
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
      [patientId, merged, sessionId]
    );
  } catch (err) {
    if (err?.code !== "42P01") {
      console.error("[doctor note] profile upsert error:", err.message || err);
    }
  }
}

/** ---------------- AI extraction (single call) ---------------- */

async function extractProfilePatchFromDoctorNoteAI(noteMd) {
  const text = safeText(noteMd).trim();
  if (!text) return null;

  const model = genAI.getGenerativeModel({
    model: MODEL_NAME,
    systemInstruction: NOTE_PROFILE_EXTRACT_PROMPT,
  });

  const result = await model.generateContent([
    {
      text:
        "Extract profile facts as STRICT JSON ONLY.\n\nDoctor note:\n" + text,
    },
  ]);

  const raw =
    result?.response?.text?.() ||
    result?.response?.candidates?.[0]?.content?.parts?.[0]?.text ||
    "";

  const parsed = extractFirstJsonObject(raw);
  if (!parsed || typeof parsed !== "object") return null;

  const sanitized = sanitizeProfilePatch(parsed);
  if (!sanitized) return null;

  const patch = {};

  const listFields = [
    "chronic_conditions",
    "past_surgical_history",
    "medications",
    "doctor_prescriptions",
    "allergies",
    "social_history",
    "family_history",
    "other_notes",
  ];

  for (const f of listFields) {
    const arr = normalizeList(sanitized[f]);
    if (arr.length) patch[f] = arr;
  }

  if (sanitized.substance_use && typeof sanitized.substance_use === "object") {
    patch.substance_use = {
      alcohol: sanitized.substance_use.alcohol ?? null,
      smoking: sanitized.substance_use.smoking ?? null,
      drugs: sanitized.substance_use.drugs ?? null,
    };
  }

  // Canonicalize + dedupe
  if (patch.allergies) {
    patch.allergies = dedupePreserve(
      patch.allergies.map(canonicalizeAllergy).filter(Boolean)
    );
  }

  if (patch.medications) {
    patch.medications = dedupePreserve(
      patch.medications.map(canonicalizePatientMedication).filter(Boolean)
    );
  }

  if (patch.doctor_prescriptions) {
    patch.doctor_prescriptions = dedupePreserve(
      patch.doctor_prescriptions.map(canonicalizePrescription).filter(Boolean)
    );
  }

  if (patch.family_history) {
    patch.family_history = dedupePreserve(
      patch.family_history.map(canonicalizeFamilyHistoryItem).filter(Boolean)
    );
  }

  if (patch.social_history) {
    patch.social_history = dedupePreserve(
      patch.social_history.map(canonicalizeSocialHistoryItem).filter(Boolean)
    );
  }

  if (patch.chronic_conditions) {
    patch.chronic_conditions = dedupePreserve(
      patch.chronic_conditions.map((s) => safeText(s).trim()).filter(Boolean)
    );
  }

  if (patch.past_surgical_history) {
    patch.past_surgical_history = dedupePreserve(
      patch.past_surgical_history.map((s) => safeText(s).trim()).filter(Boolean)
    );
  }

  if (patch.other_notes) {
    patch.other_notes = dedupePreserve(
      patch.other_notes.map((s) => safeText(s).trim()).filter(Boolean)
    );
  }

  // Backward-compat safety: if model put prescriptions into medications,
  // move any "prescription-like" items to doctor_prescriptions.
  if (
    (!patch.doctor_prescriptions || patch.doctor_prescriptions.length === 0) &&
    patch.medications &&
    patch.medications.length
  ) {
    const rx = patch.medications.filter(isPrescriptionLikeItem);
    if (rx.length) {
      patch.doctor_prescriptions = dedupePreserve(
        rx.map(canonicalizePrescription).filter(Boolean)
      );
      patch.medications = dedupePreserve(
        patch.medications
          .filter((x) => !isPrescriptionLikeItem(x))
          .map(canonicalizePatientMedication)
          .filter(Boolean)
      );
    }
  }

  return Object.keys(patch).length ? patch : null;
}

/** ---------------- Merge patch into profile ---------------- */

async function mergeDoctorNoteIntoPatientProfile({
  patientId,
  sessionId,
  doctorId,
  noteMd,
  patch,
}) {
  const existing = await readExistingProfileData(patientId);
  if (existing === null) return;

  const merged = { ...(existing || {}) };

  // One-time backward-compat migration:
  // if old data stored prescriptions under "medications", move duration-like items to doctor_prescriptions
  const prevRx = normalizeList(merged.doctor_prescriptions);
  const prevMeds = normalizeList(merged.medications);
  if ((!prevRx || prevRx.length === 0) && prevMeds && prevMeds.length) {
    const rxCandidates = prevMeds.filter(isPrescriptionLikeItem);
    if (rxCandidates.length) {
      merged.doctor_prescriptions = dedupePreserve(
        rxCandidates.map(canonicalizePrescription).filter(Boolean)
      );
      merged.medications = dedupePreserve(
        prevMeds
          .filter((x) => !isPrescriptionLikeItem(x))
          .map(canonicalizePatientMedication)
          .filter(Boolean)
      );
    }
  }

  const mergeList = (field, canonicalizeFn) => {
    const prev = normalizeList(merged[field]);
    const inc = normalizeList(patch?.[field]);

    const prevC = canonicalizeFn
      ? prev.map(canonicalizeFn).filter(Boolean)
      : prev.map((x) => safeText(x).trim()).filter(Boolean);

    const incC = canonicalizeFn
      ? inc.map(canonicalizeFn).filter(Boolean)
      : inc.map((x) => safeText(x).trim()).filter(Boolean);

    const out = dedupePreserve([...prevC, ...incC]);
    if (out.length) merged[field] = out;
  };

  // Patient meds (no durations)
  if (patch?.medications)
    mergeList("medications", canonicalizePatientMedication);

  // Doctor prescriptions (durations neat)
  if (patch?.doctor_prescriptions)
    mergeList("doctor_prescriptions", canonicalizePrescription);

  if (patch?.allergies) mergeList("allergies", canonicalizeAllergy);
  if (patch?.chronic_conditions) mergeList("chronic_conditions", null);
  if (patch?.past_surgical_history) mergeList("past_surgical_history", null);
  if (patch?.other_notes) mergeList("other_notes", null);

  if (patch?.social_history)
    mergeList("social_history", canonicalizeSocialHistoryItem);

  if (patch?.family_history)
    mergeList("family_history", canonicalizeFamilyHistoryItem);

  if (patch?.substance_use) {
    merged.substance_use = normalizeSubstanceUse(
      merged.substance_use,
      patch.substance_use
    );
  }

  // Always store clinician note per-session (replace same session)
  const prevNotes = Array.isArray(merged.clinician_notes)
    ? merged.clinician_notes
    : [];
  const nowIso = new Date().toISOString();
  const noteEntry = {
    session_id: sessionId,
    doctor_id: doctorId,
    note_md: safeText(noteMd || ""),
    updated_at: nowIso,
  };
  const withoutThisSession = prevNotes.filter(
    (n) => String(n?.session_id) !== String(sessionId)
  );
  merged.clinician_notes = [...withoutThisSession, noteEntry];

  await upsertProfileData(patientId, sessionId, merged);
}

/** ---------------- Existing endpoints (unchanged) ---------------- */

/** List all registered patients (simple MVP) */
router.get(
  "/patients",
  requireAuth,
  requireRole("doctor"),
  async (_req, res) => {
    const { rows } = await pool.query(`
    SELECT u.id AS user_id,
           COALESCE(u.display_name, u.email) AS name,
           u.email, p.date_of_birth AS date_of_birth, p.sex, u.created_at
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

/** Get a patient's consolidated profile for the doctor. */
router.get(
  "/patients/:patientId/profile",
  requireAuth,
  requireRole("doctor"),
  async (req, res) => {
    const pid = Number(req.params.patientId);

    const demo = await pool.query(
      `
      SELECT u.id AS user_id,
             COALESCE(u.display_name, u.email) AS name,
             u.email,
             u.display_name AS full_name,
             p.date_of_birth AS date_of_birth,
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
        : {},
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

/** Get doctor note for a session */
router.get(
  "/sessions/:sessionId/note",
  requireAuth,
  requireRole("doctor"),
  async (req, res) => {
    const sid = Number(req.params.sessionId);
    if (!sid) return res.status(400).json({ error: "invalid sessionId" });

    const { rows } = await pool.query(
      `
      SELECT session_id, patient_id, doctor_id, note_md, created_at, updated_at
        FROM care_ai.doctor_session_notes
       WHERE session_id = $1
       LIMIT 1
    `,
      [sid]
    );

    res.json(rows[0] || null);
  }
);

/**
 * Upsert doctor note for a session.
 * - saves the note
 * - extracts profile patch via AI (Gemini)
 * - merges patch into patient profile (neatly + deduped)
 */
router.post(
  "/sessions/:sessionId/note",
  requireAuth,
  requireRole("doctor"),
  async (req, res) => {
    try {
      const sid = Number(req.params.sessionId);
      const noteMd = safeText(req.body?.note_md ?? req.body?.note ?? "").trim();

      if (!sid) return res.status(400).json({ error: "invalid sessionId" });
      if (!noteMd) return res.status(400).json({ error: "note_md required" });
      if (noteMd.length > 20000)
        return res.status(400).json({ error: "note too long" });

      const patientId = await getSessionPatientId(sid);
      if (!patientId)
        return res.status(404).json({ error: "session not found" });

      const doctorId = req.user.sub;

      const { rows } = await pool.query(
        `
        INSERT INTO care_ai.doctor_session_notes (session_id, patient_id, doctor_id, note_md)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (session_id)
        DO UPDATE SET note_md = EXCLUDED.note_md,
                      doctor_id = EXCLUDED.doctor_id,
                      updated_at = NOW()
        RETURNING session_id, patient_id, doctor_id, note_md, created_at, updated_at
      `,
        [sid, patientId, doctorId, noteMd]
      );
      const saved = rows[0];

      const patch = await extractProfilePatchFromDoctorNoteAI(noteMd);

      await mergeDoctorNoteIntoPatientProfile({
        patientId,
        sessionId: sid,
        doctorId,
        noteMd,
        patch: patch || {},
      });

      return res.json({
        ...saved,
        extracted_profile_patch: patch || null,
      });
    } catch (err) {
      console.error("[doctor note] save failed:", err?.message || err);
      return res.status(500).json({ error: "Failed to save note" });
    }
  }
);

module.exports = router;
