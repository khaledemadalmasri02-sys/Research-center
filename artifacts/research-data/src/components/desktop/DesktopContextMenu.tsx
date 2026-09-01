import { useEffect } from "react";
import { LayoutGrid, Palette, RotateCcw } from "lucide-react";
import { useTranslation } from "react-i18next";

interface Props {
  x: number;
  y: number;
  onClose: () => void;
  onOpenLauncher: () => void;
  onOpenThemes: () => void;
  onReset: () => void;
}

export function DesktopContextMenu({
  x,
  y,
  onClose,
  onOpenLauncher,
  onOpenThemes,
  onReset,
}: Props) {
  const { t } = useTranslation();

  useEffect(() => {
    const onDocClick = () => onClose();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("click", onDocClick);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("click", onDocClick);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const Item = ({
    icon: Icon,
    label,
    onClick,
  }: {
    icon: typeof LayoutGrid;
    label: string;
    onClick: () => void;
  }) => (
    <button
      type="button"
      className="flex w-full items-center gap-2 rounded px-3 py-1.5 text-left text-sm text-white transition hover:bg-white/10"
      onClick={() => {
        onClick();
        onClose();
      }}
    >
      <Icon className="h-4 w-4" />
      {label}
    </button>
  );

  return (
    <div
      className="fixed z-50 min-w-[200px] rounded-lg border border-white/10 bg-zinc-900/95 p-1 shadow-2xl backdrop-blur"
      style={{ left: x, top: y }}
      onClick={(e) => e.stopPropagation()}
    >
      <Item icon={LayoutGrid} label={t("desktop.showApps")} onClick={onOpenLauncher} />
      <div className="my-1 h-px bg-white/10" />
      <Item icon={Palette} label={t("desktop.themes")} onClick={onOpenThemes} />
      <Item icon={RotateCcw} label={t("desktop.resetDesktop")} onClick={onReset} />
    </div>
  );
}
