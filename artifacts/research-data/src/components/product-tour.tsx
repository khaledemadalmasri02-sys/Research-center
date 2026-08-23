import { useLayoutEffect, useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { X, ChevronLeft, ChevronRight, PlayCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { useProductTour, type TourStep } from "@/hooks/use-product-tour";
import { fetchTourConfig, resolveTourVideoSrc } from "@/lib/tour-config";

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  welcome: PlayCircle,
  dashboard: PlayCircle,
  patients: PlayCircle,
  collections: PlayCircle,
  dataAnalysis: PlayCircle,
  feedback: PlayCircle,
  moreFeatures: PlayCircle,
  myActivity: PlayCircle,
  apiTokens: PlayCircle,
  sessions: PlayCircle,
  notifications: PlayCircle,
  theme: PlayCircle,
  language: PlayCircle,
  admin: PlayCircle,
  finish: PlayCircle,
};

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
  const isCenter = !current || current.placement === "center" || !current.selector;

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
    if (!open || isCenter || !current?.selector) {
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
  }, [open, step, isCenter, current]);

  if (!open || !current) return null;

  const Icon = ICONS[current.key] ?? PlayCircle;
  const title = t(`tour.steps.${current.key}.title`);
  const body = t(`tour.steps.${current.key}.body`);

  // Tooltip placement for element-highlight steps.
  let tooltipStyle: React.CSSProperties = {};
  if (!isCenter && rect) {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const spaceRight = vw - rect.right;
    const spaceLeft = rect.left;
    if (spaceRight > TOOLTIP_W + 24) {
      tooltipStyle = { top: Math.max(12, rect.top), left: rect.right + PAD };
    } else if (spaceLeft > TOOLTIP_W + 24) {
      tooltipStyle = { top: Math.max(12, rect.top), right: vw - rect.left + PAD };
    } else {
      const left = Math.min(Math.max(12, rect.left + rect.width / 2 - TOOLTIP_W / 2), vw - TOOLTIP_W - 12);
      tooltipStyle = { top: Math.min(rect.bottom + PAD, vh - 220), left };
    }
  }

  return (
    <div className="fixed inset-0 z-[55]" aria-modal="true" role="dialog">
      {/* Background blocker (transparent) so the app can't be clicked during the tour. */}
      <div className="absolute inset-0" />

      {/* Spotlight ring + darkening for element steps. */}
      {!isCenter && rect && (
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
      {isCenter && <div className="absolute inset-0 bg-black/70" />}

      {/* Guide card. */}
      <div
        className={
          isCenter
            ? "absolute z-[61] left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[min(92vw,360px)]"
            : "absolute z-[61] w-[min(92vw,340px)]"
        }
        style={isCenter ? undefined : tooltipStyle}
      >
        <div className="rounded-xl border border-border bg-card shadow-2xl overflow-hidden">
          {/* Media area: optional video clip with icon fallback. */}
          <div className="relative aspect-video bg-gradient-to-br from-primary/15 to-muted flex items-center justify-center">
            {videoOk ? (
              <video
                className="h-full w-full object-cover"
                src={videoSrc}
                autoPlay
                muted
                loop
                playsInline
                onError={handleVideoError}
              />
            ) : null}
            {!videoOk && <Icon className="h-14 w-14 text-primary/70" />}
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
