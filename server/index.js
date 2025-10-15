// server/index.js
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { GoogleGenerativeAI } = require("@google/generative-ai");

// --- DB + Routes ---
const { pool } = require("./db");
const authRoutes = require("./routes/auth");
const patientRoutes = require("./routes/patient");
const doctorRoutes = require("./routes/doctor");
const aiRoutes = require("./routes/ai");

// --- Express setup ---
const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

// --- Route registration ---
app.use("/api/auth", authRoutes);
app.use("/api/patient", patientRoutes);
app.use("/api/doctor", doctorRoutes);
app.use("/api/ai", aiRoutes);

// --- Health check (DB connectivity) ---
app.get("/api/health/db", async (_req, res) => {
  try {
    const result = await pool.query("SELECT NOW()");
    res.json({ ok: true, now: result.rows[0].now });
  } catch (err) {
    console.error("DB healthcheck failed:", err);
    res.status(500).json({ ok: false, error: "Database connection failed" });
  }
});

// --- Demo endpoint ---
app.get("/api/hello", (_req, res) => {
  res.json({ message: "Hello from Express 👋" });
});

/**
 * List the models your key can call (works with SDK 0.24.x because it uses REST).
 * Returns names like "models/gemini-2.0-flash-lite".
 */
app.get("/api/ai/models", async (_req, res) => {
  try {
    const key = process.env.GOOGLE_API_KEY;
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${key}`
    );
    const data = await r.json();
    if (!r.ok) {
      return res.status(500).json({ ok: false, error: data?.error || data });
    }
    const names = (data.models || []).map((m) => ({
      name: m.name,
      methods: m.supportedGenerationMethods,
    }));
    res.json({ ok: true, models: names });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

/**
 * Robust ping: tries several candidate model names until one works.
 * You can override with GEMINI_DEFAULT_MODEL in .env (without "models/").
 */
const CANDIDATES = [
  process.env.GEMINI_DEFAULT_MODEL, // e.g. "gemini-2.0-flash-lite"
  "gemini-2.0-flash-lite",
  "gemini-2.0-flash",
  "gemini-2.5-flash",
  "gemini-2.5-pro",
].filter(Boolean);

async function tryPingOnce(modelName) {
  const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
  const model = genAI.getGenerativeModel({ model: modelName });
  const r = await model.generateContent("Say 'pong' only.");
  return r.response?.text?.() || "(no response)";
}

app.get("/api/ai/ping", async (_req, res) => {
  for (const m of CANDIDATES) {
    try {
      const text = await tryPingOnce(m);
      return res.json({ ok: true, model: m, text });
    } catch (e) {
      const detailed =
        e?.response?.data?.error?.message ||
        e?.cause?.message ||
        e?.message ||
        String(e);
      console.error("[AI ping] model failed:", m, "|", detailed);
    }
  }
  return res
    .status(500)
    .json({ ok: false, error: "All candidate models failed" });
});

// --- Startup ---
app.listen(PORT, () =>
  console.log(`✅ API running at: http://localhost:${PORT}`)
);
