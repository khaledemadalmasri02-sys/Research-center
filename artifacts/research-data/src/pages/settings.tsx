import { useTranslation } from "react-i18next";
import { LogOut, Palette } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useDesktop } from "@/components/desktop/window-store";
import { ThemeToggle } from "@/components/theme-toggle";
import { LanguageSwitcher } from "@/components/language-switcher";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function Settings() {
  const { t } = useTranslation();
  const { username, logout } = useAuth();
  const { reset, open } = useDesktop();

  const handleReset = () => {
    if (window.confirm(t("settings.resetConfirm"))) {
      reset();
    }
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <h1 className="text-2xl font-bold tracking-tight">{t("nav.settings")}</h1>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("settings.appearance")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm">{t("settings.theme")}</span>
            <ThemeToggle />
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm">{t("settings.language")}</span>
            <LanguageSwitcher />
          </div>
          <Button variant="outline" className="w-full" onClick={() => open("theme-manager")}>
            <Palette className="mr-2 h-4 w-4" />
            {t("nav.themeManager")}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("settings.account")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">{t("settings.signedInAs")}</span>
            <span className="text-sm font-medium">{username}</span>
          </div>
          <Button variant="destructive" onClick={() => logout()} className="w-full">
            <LogOut className="mr-2 h-4 w-4" />
            {t("nav.signOut")}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("settings.desktop")}</CardTitle>
        </CardHeader>
        <CardContent>
          <Button variant="outline" onClick={handleReset} className="w-full">
            {t("desktop.resetDesktop")}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
