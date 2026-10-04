import { useTranslation } from "react-i18next";
import { Layout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Search } from "lucide-react";

/**
 * Catch-all 404.
 *
 * Previously this rendered a bare card with no navigation, raw
 * `bg-gray-50` / `text-gray-900` (so it was unreadable in dark mode), a
 * pointless `Loader2` spinner, and the developer-facing copy "Did you forget
 * to add the page to the router?" — shown to every user who mistypes a URL.
 *
 * It is now wrapped in `<Layout>`, which gives it the sidebar, an `<h1>` and
 * the `#main-content` landmark the skip link targets.
 */
export default function NotFound() {
  const { t } = useTranslation();

  return (
    <Layout>
      <div className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center text-center">
        <p className="text-6xl font-bold tracking-tight text-muted-foreground">
          {t("notFound.code")}
        </p>
        <h1 className="mt-2 text-2xl font-bold tracking-tight">{t("notFound.title")}</h1>
        <p className="mt-2 text-balance text-sm text-muted-foreground">{t("notFound.body")}</p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <Button onClick={() => window.location.assign("/")}>{t("common.goToDashboard")}</Button>
          <Button variant="outline" onClick={() => window.location.assign("/search")}>
            <Search className="mr-2 h-4 w-4" />
            {t("notFound.search")}
          </Button>
        </div>
      </div>
    </Layout>
  );
}
