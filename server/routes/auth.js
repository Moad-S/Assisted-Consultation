const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { pool } = require("../db");
const { requireAuth } = require("../middleware/authz");

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || "dev_secret_change_me";
const SUPPORTED_LANGS = ["en", "es"];

const signUser = (u) =>
  jwt.sign({ sub: u.id, email: u.email, role: u.role }, JWT_SECRET, {
    expiresIn: "2h",
  });

router.post("/signup", async (req, res) => {
  try {
    const { email, password, role, displayName } = req.body;

    if (!email || !password || !role)
      return res
        .status(400)
        .json({ error: "email, password and role are required" });
    if (!["patient", "doctor"].includes(role))
      return res
        .status(400)
        .json({ error: "role must be 'patient' or 'doctor'" });
    if (password.length < 6)
      return res
        .status(400)
        .json({ error: "password must be at least 6 characters" });

    const { rows: existing } = await pool.query(
      `SELECT id FROM care_ai.users WHERE email = $1`,
      [email]
    );
    if (existing.length)
      return res.status(409).json({ error: "email already in use" });

    const hash = await bcrypt.hash(password, 10);

    const lang = SUPPORTED_LANGS.includes(req.body.language)
      ? req.body.language
      : "en";

    const ins = await pool.query(
      `INSERT INTO care_ai.users (role, email, display_name, password_hash, language)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, role, email, display_name, language`,
      [role, email, displayName || null, hash, lang]
    );
    const user = ins.rows[0];

    if (role === "patient") {
      await pool.query(
        `INSERT INTO care_ai.patients (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING`,
        [user.id]
      );
    } else {
      await pool.query(
        `INSERT INTO care_ai.doctors (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING`,
        [user.id]
      );
    }

    const token = signUser(user);
    res.status(201).json({ token, user });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "signup failed" });
  }
});

router.post("/login", async (req, res) => {
  try {
    const { email, password, role } = req.body;
    if (!email || !password || !role)
      return res
        .status(400)
        .json({ error: "email, password and role are required" });
    if (!["patient", "doctor"].includes(role))
      return res
        .status(400)
        .json({ error: "role must be 'patient' or 'doctor'" });

    const { rows } = await pool.query(
      `SELECT id, role, email, display_name, password_hash, language
       FROM care_ai.users
       WHERE email = $1 AND role = $2`,
      [email, role]
    );
    const user = rows[0];
    if (!user) return res.status(401).json({ error: "Invalid credentials" });

    const ok = await bcrypt.compare(password, user.password_hash || "");
    if (!ok) return res.status(401).json({ error: "Invalid credentials" });

    const token = signUser(user);
    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        display_name: user.display_name,
        language: user.language || "en",
      },
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "login failed" });
  }
});

router.patch("/language", requireAuth, async (req, res) => {
  try {
    const { language } = req.body || {};
    if (!SUPPORTED_LANGS.includes(language))
      return res.status(400).json({ error: "language must be 'en' or 'es'" });

    await pool.query(`UPDATE care_ai.users SET language = $2 WHERE id = $1`, [
      req.user.sub,
      language,
    ]);
    res.json({ ok: true, language });
  } catch (e) {
    console.error("[auth] set language failed:", e);
    res.status(500).json({ error: "Failed to update language" });
  }
});

module.exports = router;
