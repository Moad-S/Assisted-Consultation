# Care-AI

An AI-powered medical intake platform for pre-consultation triage. Patients complete a structured clinical interview with an AI assistant before their appointment; doctors review session transcripts, write notes, and see AI-extracted patient profiles.

---

## How it works

**Patient flow**
1. Patient logs in and starts a chat session
2. The AI intake bot (powered by Gemini) guides them through a structured clinical history — chief concern, HPI, red flags, medications, allergies, social/family history
3. When the interview ends, a background job summarizes the transcript and extracts a structured patient profile

**Doctor flow**
1. Doctor logs in and sees a list of patients with completed sessions
2. Reviews the session transcript and AI-generated summary
3. Writes clinical notes — AI extracts and merges structured data (diagnoses, medications, allergies) into the patient's profile

---

## Tech stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19, Vite, React Router |
| Backend | Node.js, Express 4 |
| Database | PostgreSQL (schema: `care_ai`) |
| AI | Google Gemini 2.5 Flash  |
| Auth | JWT (role-based: `patient` / `doctor`) |

---

## Prerequisites

- Node.js 18+
- PostgreSQL 14+ running locally (or a connection string to a remote instance)
- A [Google AI Studio](https://aistudio.google.com) API key (free tier works)

---

## Setup

### 1. Clone and install

```bash
git clone <repo-url>
cd testing
npm install
npm --prefix server install
npm --prefix client install
```

### 2. Configure environment

Copy the example and fill in your values:

```bash
cp server/.env.example server/.env
```

```env
# server/.env

PORT=5001
NODE_ENV=development

# PostgreSQL connection string
DATABASE_URL=postgres://user:password@localhost:5432/care_ai_db
PGSSLMODE=disable

# Generate a strong random string for production
JWT_SECRET=change_me_in_prod

# Google AI
GOOGLE_API_KEY=your_google_api_key_here
GEMINI_MODEL=gemini-2.0-flash-lite

# Optional: override the default intake system prompt
# GEMINI_SYSTEM_PROMPT="..."
```

> **Never commit `.env` to version control.** It contains secrets.

### 3. Set up the database

The app expects a PostgreSQL database with a `care_ai` schema. Create the schema and tables before starting the server. Key tables:

```
care_ai.users            — email, hashed password, role (patient|doctor), display_name
care_ai.patients         — full_name, date_of_birth, sex (linked to users)
care_ai.doctors          — linked to users
care_ai.chat_sessions    — session per patient, status (active|ended), summary
care_ai.chat_messages    — sender (patient|ai|doctor), content
care_ai.patient_profiles — JSONB structured profile, built incrementally from AI extraction
care_ai.doctor_session_notes — clinical notes per session
```

### 4. Run in development

```bash
npm run dev
```

This starts both the Express server (port 5001) and the Vite dev server (port 5173) concurrently. The client proxies `/api` requests to the server automatically.

---

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start both server and client with hot reload |
| `npm run dev-server` | Server only (nodemon) |
| `npm run dev-client` | Client only (Vite) |
| `npm run build` | Build client for production |
| `npm start` | Start server in production mode |

---

## Project structure

```
├── client/                  # React SPA (Vite)
│   └── src/
│       ├── pages/           # login, signup, patienthome, doctorhome
│       ├── components/      # ProtectedRoute, Markdown
│       └── auth.js          # JWT helpers
│
├── server/                  # Express API
│   ├── routes/
│   │   ├── auth.js          # POST /api/auth/signup, /login
│   │   ├── patient.js       # Patient session & message endpoints
│   │   ├── doctor.js        # Doctor dashboard, notes, profile endpoints
│   │   └── ai.js            # AI chat reply endpoint
│   ├── middleware/
│   │   └── authz.js         # JWT verification & role checks
│   ├── ai/
│   │   └── summarizer.js    # Background summarization & profile extraction
│   ├── utils/jwt.js
│   ├── db.js                # PostgreSQL connection pool
│   └── index.js             # Server entry point
│
└── package.json             # Root scripts (concurrently)
```

---

## Known limitations (MVP)

This is a development prototype. Before handling real patient data:

- Add HTTPS / TLS termination
- Replace `localStorage` JWT storage with `httpOnly` cookies
- Add rate limiting on auth and AI endpoints (`express-rate-limit`)
- Restrict CORS to known origins
- Add input validation (`zod` or `joi`)
- Write tests
- Set up proper database migrations
- Add `helmet.js` for HTTP security headers
- Audit all PII handling for compliance requirements
