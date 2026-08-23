import { createContext, useContext, useEffect, useState, ReactNode } from "react";

type Dict = Record<string, string>;
const en: Dict = {
  appName: "Research Data Collection",
  navHome: "Home",
  navConsent: "Consent / IRB",
  navDeidentify: "De-identify",
  navCohort: "Cohort",
  navValidation: "Validation",
  navDicom: "DICOM",
  navExport: "Export",
  navStudies: "Studies",
  navMl: "ML Provenance",
  navReports: "Reports",
  navGdpr: "GDPR",
  navAudit: "Audit",
  navSearch: "Search",
  navAdmin: "Admin",
  navActivity: "Activity",
  navMyActivity: "My Activity",
  login: "Login",
  logout: "Logout",
  username: "Username",
  password: "Password",
  signIn: "Sign in",
  language: "Language",
  dark: "Dark",
  light: "Light",
  loading: "Loading…",
  notFound: "Page not found",
  save: "Save",
  cancel: "Cancel",
  patientId: "Patient ID",
  signConsent: "Sign consent",
  withdraw: "Withdraw",
  consentVersions: "Consent templates",
  consents: "Consents",
  noData: "No data.",
  error: "Error",
};
const ar: Dict = {
  appName: "جمع بيانات البحث",
  navHome: "الرئيسية",
  navConsent: "الموافقة / IRB",
  navDeidentify: "إزالة المعرفات",
  navCohort: "الفوج",
  navValidation: "التحقق",
  navDicom: "DICOM",
  navExport: "التصدير",
  navStudies: "الدراسات",
  navMl: "أصل ML",
  navReports: "التقارير",
  navGdpr: "GDPR",
  navAudit: "التدقيق",
  navSearch: "بحث",
  navAdmin: "المسؤول",
  navActivity: "النشاط",
  navMyActivity: "نشاطي",
  login: "تسجيل الدخول",
  logout: "تسجيل الخروج",
  username: "اسم المستخدم",
  password: "كلمة المرور",
  signIn: "دخول",
  language: "اللغة",
  dark: "داكن",
  light: "فاتح",
  loading: "جارٍ التحميل…",
  notFound: "الصفحة غير موجودة",
  save: "حفظ",
  cancel: "إلغاء",
  patientId: "معرف المريض",
  signConsent: "توقيع الموافقة",
  withdraw: "سحب",
  consentVersions: "قوالب الموافقة",
  consents: "الموافقات",
  noData: "لا توجد بيانات.",
  error: "خطأ",
};

interface I18nValue {
  lang: string;
  setLang: (l: string) => void;
  t: (k: string) => string;
}

const Ctx = createContext<I18nValue>({ lang: "en", setLang: () => {}, t: (k) => k });

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<string>(localStorage.getItem("lang") || "en");
  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
    localStorage.setItem("lang", lang);
  }, [lang]);
  const setLang = (l: string) => setLangState(l === "ar" ? "ar" : "en");
  const t = (k: string) => (lang === "ar" ? ar : en)[k] ?? en[k] ?? k;
  return <Ctx.Provider value={{ lang, setLang, t }}>{children}</Ctx.Provider>;
}

export const useI18n = () => useContext(Ctx);
