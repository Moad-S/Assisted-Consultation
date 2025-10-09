// server/db.js
require("dotenv").config();
const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // If you later use a host that *requires* SSL:
  // ssl: process.env.PGSSLMODE === "require" ? { rejectUnauthorized: false } : false,
});

module.exports = { pool };
