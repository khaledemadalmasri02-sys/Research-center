import { useLayoutEffect, useState, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { motion } from "framer-motion";
import { X, ChevronLeft, ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { useProductTour, type TourStep } from "@/hooks/use-product-tour";
import { fetchTourConfig, resolveTourVideoSrc, resolveTourSource } from "@/lib/tour-config";
import { TourScheme } from "@/components/tour-scheme";
import { prefersReducedMotion } from "@/lib/motion-preferences";
import { SPRING, shouldReduceMotion, useMotionPrefs } from "@/lib/motion";

const PAD = 8;
const TOOLTIP_W = 340;

/**
 * Spotlight travel uses `SPRING.smooth`, the token system's documented
 * "shared-element move" spring (zeta ~0.93, quiet ~350ms settle). A spotlight
 * is a shared element that has to arrive without bouncing: over-travel here
 * would read as the ring missing its target.
 */
const TRAVEL_SPRING = SPRING.smooth;

type Box = { top: number; left: number; width: number; height: number };

function measure(el: Element | null) {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return null;
  return r;
}

/** The spotlight ring, as a box framer can interpolate. */
function boxOf(rect: DOMRect): Box {
  return {
    top: rect.top - PAD,
    left: rect.left - PAD,
    width: rect.width + PAD * 2,
    height: rect.height + PAD * 2,
  };
}

export function ProductTour() {
  const { t } = useTranslation();
  const { open, step, steps, total, next, back, skip, finish } = useProductTour();
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [videoOk, setVideoOk] = useState(true);
  const [videoSrc, setVideoSrc] = useState("");
  const cardRef = useRef<HTMLDivElement>(null);
  const reducedMotion = shouldReduceMotion(useMotionPrefs());

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

  const titleId = current ? `tour-title-${current.key}` : "tour-title";
  const bodyId = current ? `tour-body-${current.key}` : "tour-body";
  const motionOk = !prefersReducedMotion();
  const source = current ? resolveTourSource(tourConfig, current.key) : null;

  // Keep the whole component mounted so Radix owns the focus trap, Escape
  // handling and focus restoration across the open/close transition.
  return (
    <DialogPrimitive.Root
      open={open}
      onOpenChange={(v) => {
        if (!v) finish();
      }}
    >
      <DialogPrimitive.Portal>
        {open && (
          <>
            {/* Spotlight ring + dimming for element steps. */}
            {!center && rect && (
              /* `initial` only applies at mount, so the first open fades in
                 AT the target while every later step interpolates from
                 wherever the ring currently is — that interpolation is the
                 travel, and it needs no state of its own: scroll/resize
                 re-measurements of the SAME target are also interpolated,
                 which is what keeps the ring pinned to a moving sidebar. */
              <motion.div
                aria-hidden
                initial={reducedMotion ? false : { opacity: 0, ...boxOf(rect) }}
                animate={{ ...boxOf(rect), opacity: 1 }}
                transition={reducedMotion ? { duration: 0 } : TRAVEL_SPRING}
                className="pointer-events-none fixed z-[55] rounded-lg ring-2 ring-primary"
                style={{
                  boxShadow: "0 0 0 9999px rgba(0,0,0,0.7)",
                }}
              />
            )}

            {/* Centered dim backdrop for center steps. */}
            {center && (
              <DialogPrimitive.Overlay className="fixed inset-0 z-[55] bg-black/70" />
            )}

            <DialogPrimitive.Content
              className="fixed inset-0 z-[56] focus:outline-none"
              aria-labelledby={titleId}
              aria-describedby={bodyId}
              // Focus the card itself so a screen reader announces the dialog
              // name (the <h3>) and description before the first control.
              onOpenAutoFocus={(e) => {
                e.preventDefault();
                cardRef.current?.focus();
              }}
              onCloseAutoFocus={(e) => {
                // No trigger element to restore to — let the browser decide.
                e.preventDefault();
              }}
            >
              {/* Guide card. */}
              <div
                className={
                  center
                    ? "absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[min(92vw,360px)]"
                    : "absolute w-[min(92vw,340px)]"
                }
                style={center ? undefined : tooltipStyle(rect)}
              >
                <div
                  ref={cardRef}
                  tabIndex={-1}
                  className="rounded-xl border border-border bg-card shadow-2xl overflow-hidden outline-none"
                  style={{ maxHeight: "calc(100vh - 24px)", overflowY: "auto" }}
                >
                  {/* Media area: optional video clip with icon fallback. */}
                  <div className="relative aspect-video bg-gradient-to-br from-primary/15 to-muted overflow-hidden">
                    {source === "screen" && videoOk && motionOk ? (
                      <video
                        className="h-full w-full object-cover"
                        src={videoSrc}
                        preload="none"
                        autoPlay
                        muted
                        loop
                        playsInline
                        onError={handleVideoError}
                      />
                    ) : (
                      <TourScheme stepKey={current?.key ?? ""} />
                    )}
                  </div>

                  <div className="p-4 space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <DialogPrimitive.Title id={titleId} className="text-base font-semibold leading-tight">
                        {current ? t(`tour.steps.${current.key}.title`) : ""}
                      </DialogPrimitive.Title>
                      <button
                        type="button"
                        onClick={finish}
                        aria-label={t("tour.close")}
                        className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-secondary hover:text-foreground"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>

                    <DialogPrimitive.Description id={bodyId} className="text-sm text-muted-foreground leading-relaxed">
                      {current ? t(`tour.steps.${current.key}.body`) : ""}
                    </DialogPrimitive.Description>

                    <div className="flex items-center justify-between pt-1">
                      <span className="text-xs text-muted-foreground" aria-live="polite">
                        {t("tour.stepOf", { current: step + 1, total })}
                      </span>
                      <div className="flex items-center gap-1.5">
                        <Button variant="ghost" size="sm" onClick={skip}>
                          {t("tour.skip")}
                        </Button>
                        {step > 0 && (
                          <Button variant="outline" size="sm" onClick={back}>
                            <ChevronLeft className="h-4 w-4 rtl:rotate-180" />
                            {t("tour.back")}
                          </Button>
                        )}
                        <Button size="sm" onClick={next}>
                          {step >= total - 1 ? t("tour.finish") : t("tour.next")}
                          {step < total - 1 && <ChevronRight className="h-4 w-4 rtl:rotate-180" />}
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </DialogPrimitive.Content>
          </>
        )}
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/**
 * Tooltip placement for element-highlight steps. Always clamped to stay
 * fully within the viewport (the card can otherwise float off-screen when
 * the highlighted element sits low, e.g. the bottom-of-sidebar bell).
 */
function tooltipStyle(rect: DOMRect | null): React.CSSProperties {
  if (!rect) return {};
  const vw = typeof window === "undefined" ? 1024 : window.innerWidth;
  const vh = typeof window === "undefined" ? 768 : window.innerHeight;
  const estH = 400; // approximate card height (media + text)
  const gap = PAD;
  const clampTop = (top: number) => Math.max(12, Math.min(top, vh - estH - 12));
  const clampLeft = (left: number) => Math.max(12, Math.min(left, vw - TOOLTIP_W - 12));
  const horizCenter = clampLeft(rect.left + rect.width / 2 - TOOLTIP_W / 2);

  const rightFits = rect.right + gap + TOOLTIP_W <= vw;
  const leftFits = rect.left - gap - TOOLTIP_W >= 0;

  if (rightFits) {
    return { left: rect.right + gap, top: clampTop(rect.top) };
  }
  if (leftFits) {
    return { right: vw - rect.left + gap, top: clampTop(rect.top) };
  }
  return { top: clampTop(rect.bottom + gap), left: horizCenter };
}