import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Layout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/hooks/use-auth";
import { Loader2, MessageSquare, Star } from "lucide-react";
import { useState } from "react";
import { FadeIn } from "@/lib/page-motion";

/** `value` is the API contract; the label is translated at render time. */
const TYPES = [
  { value: "general", labelKey: "feedback.typeGeneral" },
  { value: "bug", labelKey: "feedback.typeBug" },
  { value: "feature", labelKey: "feedback.typeFeature" },
  { value: "complaint", labelKey: "feedback.typeComplaint" },
  { value: "praise", labelKey: "feedback.typePraise" },
] as const;

async function submitFeedback(
  payload: { type: string; message: string; rating: number | null },
  fallbackError: string,
) {
  const res = await fetch("/api/feedback", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? fallbackError);
  }
  return res.json();
}

export default function Feedback() {
  const { t } = useTranslation();
  const { username } = useAuth();
  const qc = useQueryClient();
  const [type, setType] = useState("general");
  const [message, setMessage] = useState("");
  const [rating, setRating] = useState<number | null>(null);
  const [done, setDone] = useState(false);

  const mutation = useMutation({
    mutationFn: () => submitFeedback({ type, message, rating }, t("feedback.failed")),
    onSuccess: () => {
      setDone(true);
      setMessage("");
      setRating(null);
      setType("general");
      qc.invalidateQueries({ queryKey: ["feedback-submitted"] });
    },
    onError: () => setDone(false),
  });

  return (
    <Layout>
      <div className="max-w-2xl mx-auto space-y-6">
        <FadeIn>
          <div>
            <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
              <MessageSquare className="h-7 w-7 text-primary" aria-hidden /> {t("feedback.title")}
            </h1>
            <p className="text-muted-foreground mt-1">
              {t("feedback.signedInAs", { username })} {t("feedback.subtitle")}
            </p>
          </div>
        </FadeIn>

        <FadeIn delay={0.06}>
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-semibold">{t("feedback.yourMessage")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/*
                role="status" (polite) rather than role="alert": a successful
                submission is information, not an error, and it must never be
                announced in a way that competes with a destructive banner.
              */}
              {done && (
                <div
                  role="status"
                  aria-live="polite"
                  className="rounded-md border border-green-500/30 bg-green-500/10 px-3 py-2 text-sm text-green-700 dark:text-green-400"
                >
                  {t("feedback.thanks")}
                </div>
              )}

              <div className="space-y-1.5">
                <Label htmlFor="feedback-type">{t("feedback.type")}</Label>
                <Select value={type} onValueChange={setType}>
                  <SelectTrigger id="feedback-type">
                    <SelectValue placeholder={t("feedback.phType")} />
                  </SelectTrigger>
                  <SelectContent>
                    {TYPES.map((tt) => (
                      <SelectItem key={tt.value} value={tt.value}>
                        {t(tt.labelKey)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/*
                The rating was five unlabelled star buttons under a
                `<Label htmlFor="rating">` pointing at an id that did not exist,
                so the group had no accessible name at all. It is now a named
                group (`aria-labelledby`) whose buttons each carry their own
                name and pressed state. `role="group"` rather than
                `radiogroup` because these are toggle buttons, not a
                single-select widget with arrow-key semantics.
              */}
              <div
                role="group"
                aria-labelledby="feedback-rating-label"
                className="space-y-1.5"
              >
                <span
                  id="feedback-rating-label"
                  className="text-sm font-medium leading-none text-muted-foreground"
                >
                  {t("feedback.rating")}
                </span>
                <div className="flex items-center gap-1">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => setRating(rating === n ? null : n)}
                      className="focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
                      aria-pressed={rating === n}
                      aria-label={t("feedback.rateOne", { n })}
                    >
                      <Star
                        aria-hidden
                        className={
                          "h-6 w-6 transition-colors " +
                          (rating !== null && n <= rating
                            ? "fill-yellow-400 text-yellow-600 dark:text-yellow-400"
                            : "text-muted-foreground hover:text-yellow-500")
                        }
                      />
                    </button>
                  ))}
                  {rating !== null && (
                    <button
                      type="button"
                      onClick={() => setRating(null)}
                      className="ms-2 text-xs text-muted-foreground hover:text-foreground"
                    >
                      {t("feedback.clearRating")}
                    </button>
                  )}
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="feedback-message">{t("feedback.message")}</Label>
                <Textarea
                  id="feedback-message"
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder={t("feedback.phMessage")}
                  className="min-h-[140px]"
                  maxLength={5000}
                />
                <p className="text-xs text-muted-foreground text-end tabular-nums">
                  {message.length}/5000
                </p>
              </div>

              <Button
                onClick={() => mutation.mutate()}
                disabled={mutation.isPending || !message.trim()}
                className="w-full sm:w-auto"
              >
                {mutation.isPending ? (
                  <>
                    <Loader2 className="me-1 h-4 w-4 animate-spin" aria-hidden />{" "}
                    {t("feedback.submitting")}
                  </>
                ) : (
                  t("feedback.submit")
                )}
              </Button>
              {mutation.isError && (
                <p role="alert" className="text-sm text-destructive">
                  {(mutation.error as Error).message}
                </p>
              )}
            </CardContent>
          </Card>
        </FadeIn>
      </div>
    </Layout>
  );
}
