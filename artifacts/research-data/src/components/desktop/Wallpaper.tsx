const GRADIENTS = [
  "radial-gradient(120% 120% at 25% 15%, #6d28d9 0%, #3b0a6b 45%, #1b0635 100%)",
  "radial-gradient(120% 120% at 75% 20%, #1e3a8a 0%, #0f2962 45%, #07142e 100%)",
  "radial-gradient(120% 120% at 50% 10%, #065f46 0%, #043f33 45%, #022b24 100%)",
  "linear-gradient(135deg, #1f2937 0%, #0b1220 100%)",
];

export function Wallpaper({
  variant = 0,
  background,
  onContextMenu,
}: {
  variant?: number;
  background?: string;
  onContextMenu?: (e: React.MouseEvent) => void;
}) {
  return (
    <div
      aria-hidden
      onContextMenu={onContextMenu}
      className="absolute inset-0 -z-10"
      style={{ background: background ?? GRADIENTS[variant % GRADIENTS.length] }}
    />
  );
}
