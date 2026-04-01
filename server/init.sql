-- Care AI database schema
CREATE SCHEMA IF NOT EXISTS care_ai;

-- Users table (patients and doctors)
CREATE TABLE IF NOT EXISTS care_ai.users (
  id          SERIAL PRIMARY KEY,
  role        VARCHAR(10) NOT NULL CHECK (role IN ('patient', 'doctor')),
  email       VARCHAR(255) NOT NULL UNIQUE,
  display_name VARCHAR(255),
  password_hash TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Patients table
CREATE TABLE IF NOT EXISTS care_ai.patients (
  id            SERIAL PRIMARY KEY,
  user_id       INTEGER NOT NULL UNIQUE REFERENCES care_ai.users(id),
  full_name     VARCHAR(255),
  date_of_birth DATE,
  sex           VARCHAR(20)
);

-- Doctors table
CREATE TABLE IF NOT EXISTS care_ai.doctors (
  id      SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL UNIQUE REFERENCES care_ai.users(id)
);

-- Chat sessions
CREATE TABLE IF NOT EXISTS care_ai.chat_sessions (
  id          SERIAL PRIMARY KEY,
  patient_id  INTEGER NOT NULL REFERENCES care_ai.users(id),
  status      VARCHAR(20) NOT NULL DEFAULT 'active',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at    TIMESTAMPTZ,
  summary_md  TEXT,
  summary_at  TIMESTAMPTZ
);

-- Chat messages
CREATE TABLE IF NOT EXISTS care_ai.chat_messages (
  id          SERIAL PRIMARY KEY,
  session_id  INTEGER NOT NULL REFERENCES care_ai.chat_sessions(id),
  sender      VARCHAR(20) NOT NULL,
  content     TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Patient profiles (AI-extracted)
CREATE TABLE IF NOT EXISTS care_ai.patient_profiles (
  id                SERIAL PRIMARY KEY,
  patient_id        INTEGER NOT NULL UNIQUE REFERENCES care_ai.users(id),
  data              JSONB NOT NULL DEFAULT '{}',
  source_session_id INTEGER,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Doctor session notes
CREATE TABLE IF NOT EXISTS care_ai.doctor_session_notes (
  id          SERIAL PRIMARY KEY,
  session_id  INTEGER NOT NULL UNIQUE REFERENCES care_ai.chat_sessions(id),
  patient_id  INTEGER NOT NULL REFERENCES care_ai.users(id),
  doctor_id   INTEGER NOT NULL REFERENCES care_ai.users(id),
  note_md     TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
