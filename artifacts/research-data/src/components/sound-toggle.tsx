import { useTranslation } from "react-i18next"
import { useState } from "react"
import { Volume2, VolumeX } from "lucide-react"
import * as PopoverPrimitive from "@radix-ui/react-popover"
import { AnimatePresence, motion } from "framer-motion"
import { Button } from "@/components/ui/button"
import { Popover, PopoverTrigger } from "@/components/ui/popover"
import { Slider } from "@/components/ui/slider"
import { useSound } from "@/components/sound-provider"
import { DURATION, SPRING, shouldReduceMotion, useMotionPrefs } from "@/lib/motion"

/** Popover entrance: `SPRING.snappy`. */
const SNAPPY_SPRING = SPRING.snappy

export function SoundToggle() {
  const { t } = useTranslation()
  const { enabled, volume, toggle, setVolume, play } = useSound()
  const [open, setOpen] = useState(false)
  const reducedMotion = shouldReduceMotion(useMotionPrefs())

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9 text-muted-foreground"
          title={enabled ? t("sound.mute") : t("sound.unmute")}
          aria-label={enabled ? t("sound.mute") : t("sound.unmute")}
          aria-pressed={enabled}
        >
          {/* Mute/unmute cross-fades rather than swapping the glyph, so the
              icon keeps its box: swapping two icons changes the button's
              intrinsic width for a frame and nudges the neighbouring chrome. */}
          <span className="relative flex h-4 w-4 items-center justify-center">
            <motion.span
              aria-hidden
              className="absolute inset-0 flex items-center justify-center"
              initial={false}
              animate={{ opacity: enabled ? 1 : 0, scale: enabled ? 1 : 0.7 }}
              transition={{ duration: reducedMotion ? 0 : DURATION.instant }}
            >
              <Volume2 className="h-4 w-4" />
            </motion.span>
            <motion.span
              aria-hidden
              className="absolute inset-0 flex items-center justify-center"
              initial={false}
              animate={{ opacity: enabled ? 0 : 1, scale: enabled ? 0.7 : 1 }}
              transition={{ duration: reducedMotion ? 0 : DURATION.instant }}
            >
              <VolumeX className="h-4 w-4" />
            </motion.span>
          </span>
        </Button>
      </PopoverTrigger>

      {/* Radix `PopoverPrimitive.Content` directly instead of `PopoverContent`:
          the styled one animates with `data-[state=open]:animate-in
          zoom-in-95`, a CSS keyframe that cannot be a spring. Radix still owns
          the positioning, Escape, outside dismissal and focus restore. */}
      <PopoverPrimitive.Portal forceMount>
        <AnimatePresence>
          {open && (
            <PopoverPrimitive.Content
              forceMount
              align="end"
              sideOffset={4}
              className="z-50 w-56 rounded-md border bg-popover p-4 text-popover-foreground shadow-md outline-none"
              style={{ transformOrigin: "var(--radix-popover-content-transform-origin)" }}
            >
              <motion.div
                initial={reducedMotion ? false : { opacity: 0, scale: 0.96, y: -4 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={reducedMotion ? undefined : { opacity: 0, scale: 0.98 }}
                transition={SNAPPY_SPRING}
                className="space-y-2"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium">{t("sound.label")}</span>
                  <Button
                    variant="outline"
                    className="h-7 px-2 text-xs"
                    onClick={() => {
                      toggle()
                      if (!enabled) play("toggle-on")
                    }}
                  >
                    {enabled ? t("sound.mute") : t("sound.unmute")}
                  </Button>
                </div>
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>{t("sound.volume")}</span>
                    <span aria-live="polite">{Math.round(volume * 100)}%</span>
                  </div>
                  <Slider
                    value={[volume]}
                    min={0}
                    max={1}
                    step={0.05}
                    disabled={!enabled}
                    aria-label={t("sound.volume")}
                    onValueChange={(v) => setVolume(v[0] ?? 1)}
                    onValueCommit={() => enabled && play("click")}
                  />
                  <p className="text-xs text-muted-foreground pt-1">
                    {t("sound.shortcutHint")}
                  </p>
                </div>
              </motion.div>
            </PopoverPrimitive.Content>
          )}
        </AnimatePresence>
      </PopoverPrimitive.Portal>
    </Popover>
  )
}