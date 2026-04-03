// server/routes/ai.js
const express = require("express");
const router = express.Router();
const { pool } = require("../db");
const { requireAuth, requireRole } = require("../middleware/authz");

const { GoogleGenerativeAI } = require("@google/generative-ai");

// --- Model + prompt config (backend-only) -----------------------------------
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

/** ----------------- Patient context helpers (to avoid redundant Qs) ----------------- */
function computeAge(dob) {
  if (!dob) return null;
  const d = new Date(dob);
  if (isNaN(d.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--;
  return age;
}
function normSex(s) {
  if (!s) return "unknown";
  const t = String(s).trim().toLowerCase();
  if (["m", "male", "man"].includes(t)) return "male";
  if (["f", "female", "woman"].includes(t)) return "female";
  return t || "unknown";
}

/**
 * Fetch demographics + optional AI-extracted profile.
 * Reads care_ai.users + care_ai.patients and (optionally) care_ai.patient_profiles.
 */
async function fetchPatientContext(userId) {
  const baseQ = `
    SELECT u.email, u.display_name, u.display_name AS full_name, p.date_of_birth AS date_of_birth, p.sex, u.created_at
      FROM care_ai.users u
      JOIN care_ai.patients p ON p.user_id = u.id
     WHERE u.id = $1
  `;
  const profQ = `
    SELECT data, updated_at, source_session_id
      FROM care_ai.patient_profiles
     WHERE patient_id = $1
     LIMIT 1
  `;

  const [{ rows: baseRows }] = await Promise.all([pool.query(baseQ, [userId])]);
  const base = baseRows[0] || {};

  let profile = null;
  try {
    const { rows } = await pool.query(profQ, [userId]);
    profile = rows[0] || null;
  } catch {
    profile = null; // table may not exist yet
  }

  const name = base.full_name || base.display_name || base.email || "";
  const sex = normSex(base.sex);
  const age = computeAge(base.date_of_birth);

  const ai = (profile && profile.data) || {};
  const ctx = {
    name,
    sex,
    age,
    dob: base.date_of_birth || null,
    email: base.email || null,
    ai_profile: {
      chronic_conditions: ai.chronic_conditions || null,
      past_surgical_history: ai.past_surgical_history || null,
      medications: ai.medications || null,
      allergies: ai.allergies || null,
      social_history: ai.social_history || null,
      family_history: ai.family_history || null,
      substance_use: ai.substance_use || null,
      other_notes: ai.other_notes || null,
      source_session_id: profile?.source_session_id || null,
      updated_at: profile?.updated_at || null,
    },
  };

  // Concise context block
  const lines = [];
  lines.push(`Patient: ${name || "—"}`);
  if (sex && sex !== "unknown") lines.push(`Sex: ${sex}`);
  if (age != null) lines.push(`Age: ${age}`);
  if (ctx.dob)
    lines.push(`DOB: ${new Date(ctx.dob).toISOString().slice(0, 10)}`);
  const pushList = (label, v) => {
    if (!v) return;
    if (Array.isArray(v)) {
      if (v.length) lines.push(`${label}: ${v.join(", ")}`);
    } else if (typeof v === "string" && v.trim()) {
      lines.push(`${label}: ${v}`);
    }
  };
  pushList("Chronic conditions", ctx.ai_profile.chronic_conditions);
  pushList("Past surgical history", ctx.ai_profile.past_surgical_history);
  pushList("Medications", ctx.ai_profile.medications);
  pushList("Allergies", ctx.ai_profile.allergies);
  pushList("Social history", ctx.ai_profile.social_history);
  pushList("Family history", ctx.ai_profile.family_history);
  pushList("Substance use", ctx.ai_profile.substance_use);
  pushList("Other notes", ctx.ai_profile.other_notes);

  const textBlock =
    `PATIENT CONTEXT (from profile/EHR)\n` +
    lines.map((l) => `• ${l}`).join("\n");

  return { ctx, textBlock };
}

/** ----------------- Intake-only scrub (keep your existing behavior) ----------------- */
function stripAdvice(markdown = "") {
  const lines = String(markdown).split("\n");
  const cleaned = [];

  for (let raw of lines) {
    const line = raw.trim();
    const lower = line.toLowerCase();

    if (!line) {
      cleaned.push(raw);
      continue;
    }

    const bannedHeadings = [
      "**possible tests",
      "**imaging to discuss",
      "**medication considerations",
      "imaging:",
      "imaging to discuss:",
    ];
    if (bannedHeadings.some((h) => lower.startsWith(h))) continue;

    const hasRecommender =
      /(recommend|suggest|should|consider|start|begin|take|use|get|need|prescrib|dose)\b/i.test(
        line
      ) && !line.endsWith("?");

    const targets =
      /(x-?ray|ct\b|mri\b|ultrasound|scan|imaging|antibiotic|antivir|steroid|ibuprofen|naproxen|acetaminophen|paracetamol|amoxicillin|dose|mg\b)/i.test(
        line
      );

    if (hasRecommender && targets) continue;

    cleaned.push(raw);
  }

  const out = cleaned.join("\n").trim();
  return out.length
    ? out
    : "Thanks for the information. I’ll pass this to the doctor.";
}

// ----------------- Routes ----------------------------------------------------

/**
 * POST /api/ai/patient/chat/:sessionId/reply
 * Body: { userText?: string, kickoff?: boolean }
 * If kickoff=true, the AI will initiate the conversation with a brief greeting
 * and a single chief-concern question (no advice).
 */
router.post(
  "/patient/chat/:sessionId/reply",
  requireAuth,
  requireRole("patient"),
  async (req, res) => {
    try {
      const sessionId = Number(req.params.sessionId);
      const { userText, kickoff } = req.body || {};

      if (!sessionId) {
        return res.status(400).json({ error: "Missing sessionId" });
      }
      if (!kickoff && (!userText || !String(userText).trim())) {
        return res.status(400).json({ error: "Missing userText" });
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

      // Fetch per-patient context and build dynamic system instruction
      const { ctx, textBlock } = await fetchPatientContext(req.user.sub);

      // Demographic-driven guardrails to avoid redundant/inappropriate questions
      const demographicRules = [];
      if (ctx.sex && ctx.sex !== "unknown") {
        demographicRules.push(
          "Do NOT ask for the patient's sex/gender; it's already known."
        );
      }
      if (ctx.age != null || ctx.dob) {
        demographicRules.push(
          "Do NOT ask for age or date of birth; acknowledge implicitly if needed."
        );
      }
      // Pregnancy logic
      if (ctx.sex === "male") {
        demographicRules.push(
          "Do NOT ask about pregnancy, last menstrual period, or OB/GYN-specific questions."
        );
      } else if (ctx.sex === "female") {
        if (ctx.age != null && (ctx.age < 12 || ctx.age > 55)) {
          demographicRules.push(
            "Do NOT ask about pregnancy/LMP (age range not applicable)."
          );
        } else {
          demographicRules.push(
            "Pregnancy/LMP may be asked ONLY if clearly relevant to the chief complaint; otherwise avoid."
          );
        }
      } else {
        // unknown/nonbinary case
        demographicRules.push(
          "Ask about pregnancy/LMP only if clearly relevant; otherwise avoid."
        );
      }

      // Medication/allergy duplication reduction
      demographicRules.push(
        "If medications/allergies or chronic conditions are already listed in context, do not re-ask for long lists; instead briefly confirm changes only if relevant (e.g., 'Any changes to your medications since last time?')."
      );

      const dynamicSystem = [
        ENV_SYSTEM_PROMPT || "",
        "",
        textBlock,
        "",
        "INTERACTION RULES:",
        "- Use the patient context above to avoid repeating known facts.",
        "- Ask only for missing or unclear information related to the chief concern.",
        "- Do NOT prescribe medications or order imaging; limit to symptom clarification and triage.",
        "- Keep questions concise and one at a time.",
        ...demographicRules.map((r) => `- ${r}`),
        kickoff
          ? "\nKICKOFF BEHAVIOR: Greet the patient briefly (use their name if provided) and ask only ONE short question to elicit the chief concern. Do not give advice."
          : "",
      ]
        .filter(Boolean)
        .join("\n");

      const model = genAI.getGenerativeModel({
        model: MODEL_NAME,
        systemInstruction: dynamicSystem,
      });

      // Fallback injection for older SDKs
      const historyForChat = [
        {
          role: "user",
          parts: [{ text: `SYSTEM CONTEXT:\n${dynamicSystem}` }],
        },
        ...history,
      ];

      const chat = model.startChat({ history: historyForChat });

      // Compose the user turn
      const finalUserText = kickoff
        ? "Begin the intake now. (One short chief-concern question only.)"
        : String(userText);

      const result = await chat.sendMessage(finalUserText);

      // Robust text extraction across SDK versions
      const rawReply =
        result?.response?.text?.() ||
        result?.response?.candidates?.[0]?.content?.parts?.[0]?.text ||
        "(no response)";

      // Enforce intake-only tone
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
