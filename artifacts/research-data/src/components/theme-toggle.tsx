import { useTheme } from "next-themes";
import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTranslation } from "react-i18next";

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const { t } = useTranslation();

  return (
    <Button
      variant="ghost"
      size="icon"
      className="h-11 w-11 text-muted-foreground"
      onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
      title={t("theme.toggle")}
    >
      <Sun className="h-5 w-5 dark:hidden" />
      <Moon className="h-5 w-5 hidden dark:block" />
    </Button>
  );
}
