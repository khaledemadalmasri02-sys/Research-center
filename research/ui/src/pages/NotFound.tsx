import { Link } from "react-router-dom";
import { useI18n } from "../i18n";

export default function NotFound() {
  const { t } = useI18n();
  return (
    <div className="mx-auto mt-20 text-center">
      <h1 className="text-3xl font-bold">404</h1>
      <p className="mt-2 text-slate-500">{t("notFound")}</p>
      <Link to="/" className="mt-4 inline-block text-blue-600">← {t("navHome")}</Link>
    </div>
  );
}
