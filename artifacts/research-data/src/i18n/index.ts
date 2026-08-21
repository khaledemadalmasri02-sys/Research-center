import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import { en } from "./en";
import { ar } from "./ar";

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en.translation },
      ar: { translation: ar.translation },
    },
    fallbackLng: "en",
    interpolation: { escapeValue: false },
  });

i18n.on("languageChanged", (lng) => {
  document.documentElement.dir = lng === "ar" ? "rtl" : "ltr";
  document.documentElement.lang = lng;
});

// Apply direction on initial load too.
document.documentElement.dir = i18n.resolvedLanguage === "ar" ? "rtl" : "ltr";
document.documentElement.lang = i18n.resolvedLanguage ?? "en";

export default i18n;
