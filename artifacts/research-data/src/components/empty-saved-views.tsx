import { useTranslation } from "react-i18next";
import { Bookmark } from "lucide-react";

/**
 * One empty state for saved views.
 *
 * Three call sites previously disagreed on the copy — "No saved views",
 * "No views yet", "No search saved" — for what is the same situation.
 */
export function EmptySavedViews() {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col items-center gap-1.5 px-2 py-5 text-center">
      <Bookmark aria-hidden className="h-5 w-5 text-muted-foreground" />
      <p className="text-sm text-muted-foreground">{t("savedViews.empty")}</p>
    </div>
  );
}