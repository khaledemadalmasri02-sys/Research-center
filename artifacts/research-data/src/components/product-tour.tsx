import { useLayoutEffect, useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { X, ChevronLeft, ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { useProductTour, type TourStep } from "@/hooks/use-product-tour";
import { fetchTourConfig, resolveTourVideoSrc, resolveTourSource } from "@/lib/tour-config";
import { TourScheme } from "@/components/tour-scheme";

const PAD = 8;
const TOOLTIP_W = 340;

function measure(el: Element | null) {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return null;
  return r;
}

export function ProductTour() {
  const { t } = useTranslation();
  const { open, step, steps, total, next, back, skip, finish } = useProductTour();
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [videoOk, setVideoOk] = useState(true);
  const [videoSrc, setVideoSrc] = useState("");

  const current: TourStep | undefined = steps[step];
  const center =
    !current || current.placement === "center" || !current.selector || rect === null;

  const { data: tourConfig } = useQuery({
    queryKey: ["tour-config"],
    queryFn: ({ signal }) => fetchTourConfig(signal),
    staleTime: 60_000,
    enabled: open,
  });

  // Resolve the video for the current step, falling back to the animated
  // explainer if a screen recording is missing or fails to load.
  const animatedSrc = current ? `/tour/${current.key}.mp4` : "";
  useEffect(() => {
    if (!current) return;
    setVideoSrc(resolveTourVideoSrc(tourConfig, current.key));
    setVideoOk(true);
  }, [current?.key, tourConfig]);

  const handleVideoError = () => {
    if (videoSrc && videoSrc !== animatedSrc) {
      setVideoSrc(animatedSrc);
      setVideoOk(true);
    } else {
      setVideoOk(false);
    }
  };

  useLayoutEffect(() => {
    setVideoOk(true);
    if (!open || !current?.selector || current.placement === "center") {
      setRect(null);
      return;
    }
    const update = () => setRect(measure(document.querySelector(current.selector!)));
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open, step, center, current]);

  if (!open || !current) return null;

  const title = t(`tour.steps.${current.key}.title`);
  const body = t(`tour.steps.${current.key}.body`);
  const source = resolveTourSource(tourConfig, current.key);

  // Tooltip placement for element-highlight steps. Always clamped to stay
  // fully within the viewport (the card can otherwise float off-screen when
  // the highlighted element sits low, e.g. the bottom-of-sidebar bell).
  let tooltipStyle: React.CSSProperties = {};
  if (!center && rect) {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const estH = 400; // approximate card height (media + text)
    const gap = PAD;
    const clampTop = (top: number) => Math.max(12, Math.min(top, vh - estH - 12));
    const clampLeft = (left: number) => Math.max(12, Math.min(left, vw - TOOLTIP_W - 12));
    const horizCenter = clampLeft(rect.left + rect.width / 2 - TOOLTIP_W / 2);

    const rightFits = rect.right + gap + TOOLTIP_W <= vw;
    const leftFits = rect.left - gap - TOOLTIP_W >= 0;

    if (rightFits) {
      tooltipStyle = { left: rect.right + gap, top: clampTop(rect.top) };
    } else if (leftFits) {
      tooltipStyle = { right: vw - rect.left + gap, top: clampTop(rect.top) };
    } else {
      tooltipStyle = { top: clampTop(rect.bottom + gap), left: horizCenter };
    }
  }

  return (
    <div className="fixed inset-0 z-[55]" aria-modal="true" role="dialog">
      {/* Background blocker (transparent) so the app can't be clicked during the tour. */}
      <div className="absolute inset-0" />

      {/* Spotlight ring + darkening for element steps. */}
      {!center && rect && (
        <div
          className="pointer-events-none absolute z-[60] rounded-lg ring-2 ring-primary"
          style={{
            top: rect.top - PAD,
            left: rect.left - PAD,
            width: rect.width + PAD * 2,
            height: rect.height + PAD * 2,
            boxShadow: "0 0 0 9999px rgba(0,0,0,0.7)",
          }}
        />
      )}

      {/* Centered dim backdrop for center steps. */}
      {center && <div className="absolute inset-0 bg-black/70" />}

      {/* Guide card. */}
      <div
        className={
          center
            ? "absolute z-[61] left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[min(92vw,360px)]"
            : "absolute z-[61] w-[min(92vw,340px)]"
        }
        style={center ? undefined : tooltipStyle}
      >
        <div
          className="rounded-xl border border-border bg-card shadow-2xl overflow-hidden"
          style={{ maxHeight: "calc(100vh - 24px)", overflowY: "auto" }}
        >
          {/* Media area: optional video clip with icon fallback. */}
          <div className="relative aspect-video bg-gradient-to-br from-primary/15 to-muted overflow-hidden">
            {source === "screen" ? (
              videoOk ? (
                <video
                  className="h-full w-full object-cover"
                  src={videoSrc}
                  autoPlay
                  muted
                  loop
                  playsInline
                  onError={handleVideoError}
                />
              ) : (
                <TourScheme stepKey={current.key} />
              )
            ) : (
              <TourScheme stepKey={current.key} />
            )}
          </div>

          <div className="p-4 space-y-3">
            <div className="flex items-start justify-between gap-2">
              <h3 className="text-base font-semibold leading-tight">{title}</h3>
              <button
                type="button"
                onClick={finish}
                aria-label={t("tour.close")}
                className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-secondary hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <p className="text-sm text-muted-foreground leading-relaxed">{body}</p>

            <div className="flex items-center justify-between pt-1">
              <span className="text-xs text-muted-foreground">
                {t("tour.stepOf", { current: step + 1, total })}
              </span>
              <div className="flex items-center gap-1.5">
                <Button variant="ghost" size="sm" onClick={skip}>
                  {t("tour.skip")}
                </Button>
                {step > 0 && (
                  <Button variant="outline" size="sm" onClick={back}>
                    <ChevronLeft className="h-4 w-4" />
                    {t("tour.back")}
                  </Button>
                )}
                <Button size="sm" onClick={next}>
                  {step >= total - 1 ? t("tour.finish") : t("tour.next")}
                  {step < total - 1 && <ChevronRight className="h-4 w-4" />}
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
