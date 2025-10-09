

CREATE EXTENSION IF NOT EXISTS citext;

CREATE SCHEMA IF NOT EXISTS care_ai;

-- --- Enums ---------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE care_ai.user_role AS ENUM ('patient','doctor','admin');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE care_ai.msg_sender AS ENUM ('patient','doctor','ai');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE care_ai.encounter_status AS ENUM ('open','pending_tests','awaiting_results','closed');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE care_ai.suggestion_type AS ENUM ('test','prescription','diagnosis_hypothesis','note','referral');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE care_ai.order_status AS ENUM ('draft','ordered','in_progress','resulted','cancelled');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE care_ai.sex AS ENUM ('female','male','intersex','unknown','prefer_not_to_say');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- --- Core: accounts ------------------------------------------------------
CREATE TABLE IF NOT EXISTS care_ai.users (
  id              BIGSERIAL PRIMARY KEY,
  role            care_ai.user_role NOT NULL,
  email           CITEXT UNIQUE,
  phone           TEXT UNIQUE,
  display_name    TEXT,
  -- store hash in your auth service; keep nullable if you use external SSO
  password_hash   TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  is_active       BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE INDEX IF NOT EXISTS idx_users_role ON care_ai.users(role);

CREATE TABLE IF NOT EXISTS care_ai.patients (
  user_id         BIGINT PRIMARY KEY REFERENCES care_ai.users(id) ON DELETE CASCADE,
  sex             care_ai.sex,
  birth_date      DATE,
  medical_history TEXT,              -- high-level background
  allergies       TEXT,
  meta            JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS care_ai.doctors (
  user_id         BIGINT PRIMARY KEY REFERENCES care_ai.users(id) ON DELETE CASCADE,
  specialty       TEXT,
  license_no      TEXT,
  meta            JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- --- Encounters (a consultation) ---------------------------------
CREATE TABLE IF NOT EXISTS care_ai.encounters (
  id              BIGSERIAL PRIMARY KEY,
  patient_id      BIGINT NOT NULL REFERENCES care_ai.patients(user_id) ON DELETE RESTRICT,
  doctor_id       BIGINT REFERENCES care_ai.doctors(user_id) ON DELETE SET NULL,
  status          care_ai.encounter_status NOT NULL DEFAULT 'open',
  started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at       TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_encounters_patient ON care_ai.encounters(patient_id);
CREATE INDEX IF NOT EXISTS idx_encounters_doctor ON care_ai.encounters(doctor_id);

-- --- Intake Questions & Answers -----------------------------------------
CREATE TABLE IF NOT EXISTS care_ai.questions (
  id              BIGSERIAL PRIMARY KEY,
  text            TEXT NOT NULL,
  category        TEXT,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS care_ai.patient_answers (
  id              BIGSERIAL PRIMARY KEY,
  encounter_id    BIGINT NOT NULL REFERENCES care_ai.encounters(id) ON DELETE CASCADE,
  question_id     BIGINT REFERENCES care_ai.questions(id) ON DELETE SET NULL,
  answer_text     TEXT,
  answer_json     JSONB,                         -- optional structured
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_answers_encounter ON care_ai.patient_answers(encounter_id);

-- --- AI Sessions & Messages (chat history + system prompt) ---------------
CREATE TABLE IF NOT EXISTS care_ai.ai_sessions (
  id              BIGSERIAL PRIMARY KEY,
  encounter_id    BIGINT NOT NULL REFERENCES care_ai.encounters(id) ON DELETE CASCADE,
  model           TEXT,                          -- e.g., gpt-4o, gemini-1.5
  system_prompt   TEXT,                          -- the prompt in use
  temperature     NUMERIC(3,2),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_sessions_encounter ON care_ai.ai_sessions(encounter_id);

CREATE TABLE IF NOT EXISTS care_ai.messages (
  id              BIGSERIAL PRIMARY KEY,
  ai_session_id   BIGINT NOT NULL REFERENCES care_ai.ai_sessions(id) ON DELETE CASCADE,
  sender          care_ai.msg_sender NOT NULL,
  content         TEXT NOT NULL,
  tokens_in       INT,
  tokens_out      INT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_messages_session ON care_ai.messages(ai_session_id);

-- --- AI Suggestions (tests/prescriptions/diagnosis candidates) -----------
CREATE TABLE IF NOT EXISTS care_ai.ai_suggestions (
  id              BIGSERIAL PRIMARY KEY,
  encounter_id    BIGINT NOT NULL REFERENCES care_ai.encounters(id) ON DELETE CASCADE,
  suggestion_type care_ai.suggestion_type NOT NULL,
  payload         JSONB NOT NULL,               -- flexible: e.g., { "test_code": "...", "dose": "..."}
  confidence      NUMERIC(4,3),                 -- 0..1
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  accepted_by_doctor BOOLEAN,                   -- null=undecided, true/false=verified
  decided_by      BIGINT REFERENCES care_ai.doctors(user_id) ON DELETE SET NULL,
  decided_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_suggestions_encounter ON care_ai.ai_suggestions(encounter_id);

-- --- Catalog of clinical tests & orders/results --------------------------
CREATE TABLE IF NOT EXISTS care_ai.test_catalog (
  id              BIGSERIAL PRIMARY KEY,
  code            TEXT UNIQUE,                  -- e.g., LOINC/CPT if available
  name            TEXT NOT NULL,
  description     TEXT
);

CREATE TABLE IF NOT EXISTS care_ai.test_orders (
  id              BIGSERIAL PRIMARY KEY,
  encounter_id    BIGINT NOT NULL REFERENCES care_ai.encounters(id) ON DELETE CASCADE,
  test_id         BIGINT NOT NULL REFERENCES care_ai.test_catalog(id) ON DELETE RESTRICT,
  source          TEXT NOT NULL,                -- 'doctor' or 'ai'
  status          care_ai.order_status NOT NULL DEFAULT 'ordered',
  ordered_by      BIGINT REFERENCES care_ai.doctors(user_id) ON DELETE SET NULL,
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_orders_encounter ON care_ai.test_orders(encounter_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON care_ai.test_orders(status);

CREATE TABLE IF NOT EXISTS care_ai.test_results (
  id              BIGSERIAL PRIMARY KEY,
  order_id        BIGINT NOT NULL REFERENCES care_ai.test_orders(id) ON DELETE CASCADE,
  result_json     JSONB NOT NULL,               -- structured lab values
  observed_at     TIMESTAMPTZ,
  attachment_url  TEXT,                         -- link to PDF/image if stored externally
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- --- Prescriptions --------------------------------------------------------
CREATE TABLE IF NOT EXISTS care_ai.prescriptions (
  id              BIGSERIAL PRIMARY KEY,
  encounter_id    BIGINT NOT NULL REFERENCES care_ai.encounters(id) ON DELETE CASCADE,
  source          TEXT NOT NULL,                -- 'doctor' or 'ai'
  prescribed_by   BIGINT REFERENCES care_ai.doctors(user_id) ON DELETE SET NULL,
  items           JSONB NOT NULL,               -- [{drug, dose, route, frequency, duration, notes}]
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- --- Doctor Notes / Observations -----------------------------------------
CREATE TABLE IF NOT EXISTS care_ai.doctor_notes (
  id              BIGSERIAL PRIMARY KEY,
  encounter_id    BIGINT NOT NULL REFERENCES care_ai.encounters(id) ON DELETE CASCADE,
  author_doctor_id BIGINT REFERENCES care_ai.doctors(user_id) ON DELETE SET NULL,
  note            TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- --- Basic seeds ----------------------------------------------------------
INSERT INTO care_ai.users (role, email, display_name)
VALUES 
  ('admin','admin@example.com','Admin'),
  ('doctor','dr@example.com','Dr. Rivera'),
  ('patient','patient@example.com','Alex Patient')
ON CONFLICT DO NOTHING;

INSERT INTO care_ai.doctors (user_id, specialty)
SELECT id, 'Internal Medicine' FROM care_ai.users WHERE email='dr@example.com'
ON CONFLICT DO NOTHING;

INSERT INTO care_ai.patients (user_id, sex, birth_date, medical_history)
SELECT id, 'unknown', '1995-01-01', 'No major history.'
FROM care_ai.users WHERE email='patient@example.com'
ON CONFLICT DO NOTHING;

INSERT INTO care_ai.test_catalog (code, name, description) VALUES
('CBC','Complete Blood Count','Standard hematology panel'),
('CRP','C-Reactive Protein','Inflammatory marker')
ON CONFLICT DO NOTHING;
