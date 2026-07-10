import { useState } from "react";
import { useNavigate, useParams, Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { auth } from "../auth";

async function jsonOrThrow(res, fallback = "Request failed") {
  let data = null;
  try { data = await res.json(); } catch {
    // Use the caller's fallback when the response has no JSON body.
  }
  if (!res.ok) throw new Error((data && data.error) || fallback);
  return data;
}

export default function Login() {
  const nav = useNavigate();
  const { t, i18n } = useTranslation();
  const { who } = useParams();
  const role = who === "doctor" ? "doctor" : "patient";

  const [email, setEmail] = useState(
    role === "patient" ? "patient@example.com" : "doctor@example.com"
  );
  const [password, setPassword] = useState(
    role === "patient" ? "patient123" : "doctor123"
  );
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const already = auth.isLoggedIn();
  const currentRole = auth.role();

  const isDoctor = role === "doctor";

  async function onSubmit(e) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), password, role }),
      });
      const data = await jsonOrThrow(res, t("errors.loginFailed"));
      const language = i18n.resolvedLanguage?.startsWith("es") ? "es" : "en";
      auth.save(data);
      auth.setLanguage(language);
      try {
        await fetch("/api/auth/language", {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${auth.token()}`,
          },
          body: JSON.stringify({ language }),
        });
      } catch {
        // Keep the selected UI language even if account sync is temporarily unavailable.
      }
      nav(role === "doctor" ? "/doctor" : "/patient", { replace: true });
    } catch (err) {
      setError(err.message || t("errors.loginFailed"));
    } finally {
      setBusy(false);
    }
  }

  function signOutAndStay() {
    auth.clear();
    nav(`/login/${role}`, { replace: true });
  }

  return (
    <div className="max-w-sm mx-auto pt-8 sm:pt-16">
      <div className="text-center mb-8">
        <div className={`w-14 h-14 mx-auto mb-5 rounded-2xl flex items-center justify-center shadow-sm
          ${isDoctor ? "bg-doctor-soft text-doctor" : "bg-primary-100 text-primary-700"}`}>
          {isDoctor ? (
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 3v18h18"/><path d="M18 17V9"/><path d="M13 17V5"/><path d="M8 17v-3"/>
            </svg>
          ) : (
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
              <circle cx="12" cy="7" r="4"/>
            </svg>
          )}
        </div>
        <h1 className="font-display text-2xl font-bold text-ink tracking-tight mb-2">
          {t("login.title", { role: t(`common.roles.${role}`) })}
        </h1>
        <div className="flex items-center justify-center gap-3 text-sm">
          <Link
            to="/login/patient"
            className={`font-medium px-3 py-1.5 rounded-full transition ${role === "patient" ? "bg-primary-100 text-primary-700" : "text-ink-muted hover:text-ink hover:bg-canvas"}`}
          >
            {t("nav.patient")}
          </Link>
          <Link
            to="/login/doctor"
            className={`font-medium px-3 py-1.5 rounded-full transition ${role === "doctor" ? "bg-doctor-soft text-doctor" : "text-ink-muted hover:text-ink hover:bg-canvas"}`}
          >
            {t("nav.doctor")}
          </Link>
        </div>
      </div>

      {already && (
        <div className="mb-5 p-4 bg-amber-50 border border-amber-200/60 rounded-xl flex items-center justify-between">
          <span className="text-sm text-amber-800">
            {t("auth.signedInAs")} <strong className="capitalize">{t(`common.roles.${currentRole}`)}</strong>
          </span>
          <button
            onClick={signOutAndStay}
            className="text-sm text-danger hover:text-red-700 font-medium px-3 py-1 rounded-lg hover:bg-red-50 transition cursor-pointer"
          >
            {t("auth.switch")}
          </button>
        </div>
      )}

      <div className="bg-white rounded-2xl shadow-sm border border-border p-7">
        <form onSubmit={onSubmit} className="space-y-5">
          <div>
            <label className="block text-sm font-medium text-ink mb-2">{t("common.email")}</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="username"
              disabled={busy || already}
              className="w-full px-4 py-3 rounded-xl border border-border bg-canvas/50 text-ink placeholder:text-ink-faint focus:ring-2 focus:ring-primary-400 focus:border-primary-400 transition disabled:opacity-50"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-ink mb-2">{t("common.password")}</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
              disabled={busy || already}
              className="w-full px-4 py-3 rounded-xl border border-border bg-canvas/50 text-ink placeholder:text-ink-faint focus:ring-2 focus:ring-primary-400 focus:border-primary-400 transition disabled:opacity-50"
            />
          </div>

          <button
            type="submit"
            disabled={busy || already}
            className={`w-full font-semibold px-4 py-3 rounded-full transition-all shadow-sm hover:shadow-md disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer
              ${isDoctor
                ? "bg-doctor text-white hover:bg-indigo-600"
                : "bg-primary-600 text-white hover:bg-primary-700"
              }`}
          >
            {busy ? t("login.signingIn") : t("login.signIn")}
          </button>

          {error && (
            <div className="flex items-center gap-2 p-3 bg-red-50 rounded-xl">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-danger shrink-0"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
              <p className="text-sm text-danger font-medium">{error}</p>
            </div>
          )}
        </form>
      </div>

      <p className="text-center text-sm text-ink-muted mt-6">
        {t("login.noAccount")}{" "}
        <Link to="/signup" className="text-primary-600 hover:text-primary-700 font-semibold underline underline-offset-2 decoration-primary-300 transition">
          {t("login.createOne")}
        </Link>
      </p>
    </div>
  );
}
