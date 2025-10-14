// server/index.js
require("dotenv").config();
const express = require("express");
const cors = require("cors");

const { pool } = require("./db");
const authRoutes = require("./routes/auth"); // your DB-backed signup/login
const patientRoutes = require("./routes/patient");
const doctorRoutes = require("./routes/doctor");

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

app.use("/api/patient", patientRoutes);
app.use("/api/doctor", doctorRoutes);

// DB healthcheck
app.get("/api/health/db", async (_req, res) => {
  try {
    const r = await pool.query("select now()");
    res.json({ ok: true, now: r.rows[0].now });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: "db connection failed" });
  }
});

// API routes
app.use("/api/auth", authRoutes);

// demo route
app.get("/api/hello", (_req, res) =>
  res.json({ message: "Hello from Express 👋" })
);

app.listen(PORT, () => console.log(`API on http://localhost:${PORT}`));
