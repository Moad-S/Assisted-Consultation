import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import en from "./en.json";
import es from "./es.json";

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      es: { translation: es },
    },
    fallbackLng: "en",
    supportedLngs: ["en", "es"],
    nonExplicitSupportedLngs: true,
    detection: {
      order: ["localStorage", "navigator"],
      lookupLocalStorage: "i18nextLng",
      caches: ["localStorage"],
    },
    interpolation: { escapeValue: false },
  });

// Keep <html lang> in sync with the active language
const applyHtmlLang = (lng) => {
  if (typeof document !== "undefined") {
    document.documentElement.lang = lng?.startsWith("es") ? "es" : "en";
  }
};
applyHtmlLang(i18n.resolvedLanguage || i18n.language);
i18n.on("languageChanged", applyHtmlLang);

export default i18n;
