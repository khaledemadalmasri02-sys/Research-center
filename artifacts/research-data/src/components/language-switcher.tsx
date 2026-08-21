import { useTranslation } from "react-i18next";
import { Languages } from "lucide-react";
import { Button } from "@/components/ui/button";

export function LanguageSwitcher() {
  const { i18n } = useTranslation();

  const toggle = () => {
    void i18n.changeLanguage(i18n.resolvedLanguage === "ar" ? "en" : "ar");
  };

  return (
    <Button
      variant="ghost"
      size="icon"
      className="h-11 w-11 text-muted-foreground"
      onClick={toggle}
      title={i18n.resolvedLanguage === "ar" ? "EN" : "ع"}
    >
      <Languages className="h-5 w-5" />
    </Button>
  );
}
