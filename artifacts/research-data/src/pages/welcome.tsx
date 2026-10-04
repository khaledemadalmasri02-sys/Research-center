import { Link } from "wouter";
import { motion } from "framer-motion";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import {
  BrainCircuit,
  Code2,
  Database,
  Download,
  FileCheck,
  FileText,
  Image as ImageIcon,
  LayoutGrid,
  ShieldCheck,
  Users,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { prefersReducedMotion } from "@/lib/motion-preferences";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EASE_OUT } from "@/lib/motion";

type Feature = {
  key: string;
  href: string;
  labelKey: string;
  icon: React.ComponentType<{ className?: string }>;
};

const heroVideo = "/tour/welcome.mp4";

const FEATURES: Feature[] = [
  { key: "records", href: "/patients", labelKey: "nav.patients", icon: Database },
  { key: "collections", href: "/collections", labelKey: "nav.collections", icon: FileText },
  { key: "consent", href: "/consent", labelKey: "features.consent.title", icon: FileCheck },
  { key: "deidentify", href: "/deidentify", labelKey: "features.deidentify.title", icon: ShieldCheck },
  { key: "cohort", href: "/cohort", labelKey: "features.cohort.title", icon: Users },
  { key: "dicom", href: "/dicom", labelKey: "features.dicom.title", icon: ImageIcon },
  { key: "search", href: "/search", labelKey: "features.search.title", icon: FileText },
  { key: "studies", href: "/studies", labelKey: "features.studies.title", icon: Database },
  { key: "ml", href: "/ml", labelKey: "features.ml.title", icon: BrainCircuit },
  { key: "export", href: "/export", labelKey: "features.export.title", icon: Download },
  { key: "moreFeatures", href: "/more-features", labelKey: "nav.moreFeatures", icon: LayoutGrid },
];

type TourStep = {
  key: "welcome" | "patients" | "dataAnalysis" | "moreFeatures";
  src: string;
};

const TOUR_STEPS: TourStep[] = [
  { key: "welcome", src: "/tour/welcome.mp4" },
  { key: "patients", src: "/tour/patients.mp4" },
  { key: "dataAnalysis", src: "/tour/dataAnalysis.mp4" },
  { key: "moreFeatures", src: "/tour/moreFeatures.mp4" },
];

export default function Welcome() {
  const { t } = useTranslation();
  const motionAllowed = !prefersReducedMotion();
  /*
   * `Welcome` is only reachable on a public route (App.tsx renders it under
   * `if (!authenticated)`), so the visitor is signed out by construction.
   * Reading `useAuth()` here would additionally require a QueryClientProvider
   * that the public route tree does not mount.
   */
  const authenticated = false;

  return (
    <div className="min-h-screen bg-background text-foreground antialiased">
       <div
         aria-hidden="true"
         className="pointer-events-none fixed inset-0 -z-10 overflow-hidden"
       >
         <div className="absolute -top-44 -left-32 h-[32rem] w-[32rem] rounded-full bg-emerald-400/30 blur-[110px] dark:bg-emerald-300/20" />
         <div className="absolute -bottom-44 -right-32 h-[32rem] w-[32rem] rounded-full bg-teal-600/30 blur-[110px] dark:bg-teal-500/20" />
       </div>

      <header className="sticky top-0 z-20 border-b border-border bg-card/70 backdrop-blur">
        <div className="container mx-auto flex h-16 items-center justify-between px-4">
          <Link href="/login" className="text-xl font-bold tracking-tight">
            MedResearch
          </Link>
          <Button asChild>
            <Link href="/login">{t("landing.signIn")}</Link>
          </Button>
        </div>
      </header>

      <main className="container mx-auto px-4 py-16 sm:py-20">
        {/* The page had no <h1> at all — the hero copy was an <h2>, so the
            document had no accessible name. */}
        <h1 className="sr-only">{t("welcome.h1")}</h1>
        <section className="mx-auto grid max-w-6xl gap-10 lg:grid-cols-2 lg:items-center">
          <div>
            <h2 className="text-4xl font-extrabold tracking-tight sm:text-5xl">
              {t("landing.headline", "Medical research, simplified.")}
            </h2>
            <p className="mt-5 max-w-md text-lg text-muted-foreground">
              {t(
                "landing.subhead",
                "A privacy-first platform for collecting, de-identifying, and analyzing research data with auditable consent.",
              )}
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Button asChild size="lg">
                <Link href="/login">{t("landing.signIn")}</Link>
              </Button>
              <Button asChild variant="outline" size="lg">
                <Link href="/signup">{t("landing.signUp", "Sign up")}</Link>
              </Button>
            </div>
          </div>
          <div className="relative aspect-video w-full overflow-hidden rounded-2xl border border-border shadow-xl">
            {/* The landing page had five autoplaying videos (hero + 4 tour
                cards) all starting at once, with no `preload`, no poster and
                no <track kind="captions"> — WCAG 1.2.2 fail plus a heavy
                first paint. Only the hero autoplays, and only when motion is
                allowed; the rest load on demand. */}
            <video
              className="h-full w-full object-cover"
              src={heroVideo}
              poster="/tour/welcome-poster.jpg"
              preload="none"
              autoPlay={motionAllowed}
              muted
              loop={motionAllowed}
              playsInline
              controls
              aria-label={t("landing.watchTour", "Watch a quick tour")}
            >
              <track
                kind="captions"
                src="/tour/welcome.en.vtt"
                srcLang="en"
                label="English"
                default
              />
            </video>
          </div>
        </section>

        {!authenticated && (
          <p
            role="status"
            className="mt-8 rounded-md border bg-card px-3 py-2 text-sm text-muted-foreground"
          >
            {t("welcome.signedOutNotice")}{" "}
            <Link href="/login" className="text-primary underline underline-offset-2">
              {t("landing.signIn")}
            </Link>
          </p>
        )}

        <section className="mt-16">
          <h2 className="text-2xl font-bold">{t("landing.featuresTitle")}</h2>
          <p className="mt-1 text-muted-foreground">{t("landing.featuresSubtitle")}</p>
          <motion.ul
            className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
            initial="hidden"
            animate="show"
            variants={{
              hidden: { opacity: 0 },
              show: {
                opacity: 1,
                transition: { staggerChildren: 0.05, delayChildren: 0.08, duration: 0 },
              },
            }}
          >
            {FEATURES.map((f) => {
              /* Every card linked straight at an authenticated route. A
               * signed-out visitor clicking one silently re-rendered Welcome
               * (the auth gate bounced them back), and `tabIndex={-1}` made all
               * 11 cards unreachable by keyboard — a keyboard-only visitor
               * could not see the product at all. */
              const href = authenticated ? f.href : `/login?next=${encodeURIComponent(f.href)}`;
              return (
              <motion.li key={f.href} variants={{ show: { transition: { duration: 0.3, ease: EASE_OUT } } }}>
                <Link href={href}>
                  <Card className="h-full cursor-pointer border border-transparent bg-card shadow-sm transition hover:border-emerald-500 dark:bg-slate-900/60">
                    <CardContent className="flex items-center gap-3 p-4">
                      <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40">
                        <f.icon className="h-5 w-5" aria-hidden="true" />
                      </span>
                        <span className="truncate text-sm font-medium">
                        {t(f.labelKey)}
                      </span>
                    </CardContent>
                  </Card>
                </Link>
              </motion.li>
              );
            })}
          </motion.ul>
        </section>

        <section className="mt-16">
          <h3 className="text-2xl font-bold">{t("tour.title", "Product guide")}</h3>
          <p className="mt-1 text-muted-foreground">
            {t("tour.stepOf", "Step {{current}} of {{total}}", { current: 1, total: TOUR_STEPS.length })}
          </p>
          <ul className="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-2">
            {TOUR_STEPS.map((s) => (
              <TourVideo key={s.key} step={s} t={t} />
            ))}
          </ul>
        </section>

        <section className="mt-16">
          <div className="mx-auto max-w-3xl text-center">
            <ShieldCheck className="mx-auto h-10 w-10 text-cyan-500" aria-hidden="true" />
            <h3 className="mt-3 text-2xl font-bold">
              {t("landing.securityTitle", "Built for sensitive research data")}
            </h3>
            <p className="mt-2 text-muted-foreground">
              {t(
                "landing.securityBody",
                "Encrypted sessions, double-submit CSRF protection, role-based access control, and a full audit trail on every action.",
              )}
            </p>
          </div>
        </section>
      </main>

      <footer className="border-t border-slate-200/60 py-6 text-center text-sm text-slate-500 dark:border-slate-800/60">
        {t("landing.footer", "MedResearch — privacy-first medical data research platform.")}
      </footer>
    </div>
  );
}

function TourVideo({ step, t }: { step: TourStep; t: TFunction }) {
  const title = t(`tour.steps.${step.key}.title`, step.key);
  const body = t(`tour.steps.${step.key}.body`, "");
  return (
    <li className="group overflow-hidden rounded-xl border border-border">
      <div className="relative aspect-video bg-muted">
        <video
          className="h-full w-full object-cover"
          src={step.src}
          poster={`/tour/${step.key}-poster.jpg`}
          controls
          preload="none"
          muted
          playsInline
          aria-label={title}
        >
          <track
            kind="captions"
            src={`/tour/${step.key}.en.vtt`}
            srcLang="en"
            label="English"
            default
          />
        </video>
      </div>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      {body && <CardContent className="pt-0 text-sm text-muted-foreground">{body}</CardContent>}
    </li>
  );
}
