import { useTranslation } from "react-i18next";
import { auth } from "../auth";

const LANGS = ["en", "es"];

export default function LanguageToggle() {
  const { i18n } = useTranslation();
  const active = i18n.resolvedLanguage?.startsWith("es") ? "es" : "en";

  async function pick(lng) {
    if (lng === active) return;
    i18n.changeLanguage(lng);
    // Persist server-side so async jobs (summary, profile extraction) match
    if (auth.isLoggedIn()) {
      auth.setLanguage(lng);
      try {
        await fetch("/api/auth/language", {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${auth.token()}`,
          },
          body: JSON.stringify({ language: lng }),
        });
      } catch {
        /* non-fatal: the local UI language still switched */
      }
    }
  }

  return (
    <div className="flex items-center rounded-full border border-border bg-white p-0.5">
      {LANGS.map((lng) => (
        <button
          key={lng}
          type="button"
          onClick={() => pick(lng)}
          aria-pressed={active === lng}
          className={`px-2.5 py-1 rounded-full text-xs font-semibold uppercase tracking-wide transition cursor-pointer
            ${active === lng ? "bg-ink text-white shadow-sm" : "text-ink-muted hover:text-ink"}`}
        >
          {lng}
        </button>
      ))}
    </div>
  );
}
