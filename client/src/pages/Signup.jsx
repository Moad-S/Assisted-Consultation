import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
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

export default function Signup() {
  const nav = useNavigate();
  const { t, i18n } = useTranslation();
  const [role, setRole] = useState("patient");
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const already = auth.isLoggedIn();
  const currentRole = auth.role();

  async function onSubmit(e) {
    e.preventDefault();
    setError("");

    if (password.length < 6) {
      setError(t("signup.passwordMin"));
      return;
    }

    setBusy(true);
    try {
      const res = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email.trim(),
          password,
          role,
          displayName: displayName || null,
          language: i18n.resolvedLanguage?.startsWith("es") ? "es" : "en",
        }),
      });
      const data = await jsonOrThrow(res, t("errors.signupFailed"));
      auth.save(data);
      nav(role === "doctor" ? "/doctor" : "/patient", { replace: true });
    } catch (err) {
      setError(err.message || t("errors.signupFailed"));
    } finally {
      setBusy(false);
    }
  }

  function signOutAndStay() {
    auth.clear();
    nav("/signup", { replace: true });
  }

  return (
    <div className="max-w-sm mx-auto pt-8 sm:pt-16">
      <div className="text-center mb-8">
        <div className="w-14 h-14 mx-auto mb-5 rounded-2xl bg-primary-100 text-primary-700 flex items-center justify-center shadow-sm">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/>
            <circle cx="9" cy="7" r="4"/>
            <line x1="19" y1="8" x2="19" y2="14"/>
            <line x1="22" y1="11" x2="16" y2="11"/>
          </svg>
        </div>
        <h1 className="font-display text-2xl font-bold text-ink tracking-tight mb-2">{t("signup.title")}</h1>
        <p className="text-sm text-ink-muted">{t("signup.subtitle")}</p>
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
            <label className="block text-sm font-medium text-ink mb-2">{t("signup.iAmA")}</label>
            <div className="grid grid-cols-2 gap-2">
              {["patient", "doctor"].map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setRole(r)}
                  disabled={busy || already}
                  className={`py-2.5 rounded-xl text-sm font-semibold capitalize transition cursor-pointer border
                    ${role === r
                      ? r === "doctor"
                        ? "bg-doctor-soft text-doctor border-doctor/30"
                        : "bg-primary-50 text-primary-700 border-primary-300"
                      : "bg-canvas/50 text-ink-muted border-border hover:border-ink-faint"
                    } disabled:opacity-50`}
                >
                  {t(`common.roles.${r}`)}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-ink mb-2">
              {t("signup.displayName")} <span className="text-ink-faint font-normal">{t("common.optional")}</span>
            </label>
            <input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              disabled={busy || already}
              className="w-full px-4 py-3 rounded-xl border border-border bg-canvas/50 text-ink placeholder:text-ink-faint focus:ring-2 focus:ring-primary-400 focus:border-primary-400 transition disabled:opacity-50"
            />
          </div>

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
              autoComplete="new-password"
              disabled={busy || already}
              className="w-full px-4 py-3 rounded-xl border border-border bg-canvas/50 text-ink placeholder:text-ink-faint focus:ring-2 focus:ring-primary-400 focus:border-primary-400 transition disabled:opacity-50"
            />
          </div>

          <button
            type="submit"
            disabled={busy || already}
            className="w-full bg-ink text-white font-semibold px-4 py-3 rounded-full transition-all shadow-sm hover:shadow-md hover:bg-ink/85 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
          >
            {busy ? t("signup.creating") : t("signup.createAccount")}
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
        {t("signup.haveAccount")}{" "}
        <Link to="/login/patient" className="text-primary-600 hover:text-primary-700 font-semibold underline underline-offset-2 decoration-primary-300 transition">
          {t("signup.signIn")}
        </Link>
      </p>
    </div>
  );
}
