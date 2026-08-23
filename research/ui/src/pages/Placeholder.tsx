import { useI18n } from "../i18n";

export default function Placeholder({ title, note }: { title: string; note?: string }) {
  const { t } = useI18n();
  return (
    <div>
      <h1 className="mb-2 text-xl font-semibold">{title}</h1>
      <p className="text-sm text-slate-500">
        {note ?? "This module is wired to the API but its UI is being completed in a later phase."}
      </p>
      <p className="mt-2 text-sm text-slate-400">{t("noData")}</p>
    </div>
  );
}
