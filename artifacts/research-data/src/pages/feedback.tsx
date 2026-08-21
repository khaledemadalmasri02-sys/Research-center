import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/hooks/use-auth";
import { Loader2, MessageSquare, Star } from "lucide-react";
import { useState } from "react";

const TYPES = [
  { value: "general", label: "General" },
  { value: "bug", label: "Bug report" },
  { value: "feature", label: "Feature request" },
  { value: "complaint", label: "Complaint" },
  { value: "praise", label: "Praise" },
];

async function submitFeedback(payload: { type: string; message: string; rating: number | null }) {
  const res = await fetch("/api/feedback", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as any).error ?? "Failed to submit feedback");
  }
  return res.json();
}

export default function Feedback() {
  const { username } = useAuth();
  const qc = useQueryClient();
  const [type, setType] = useState("general");
  const [message, setMessage] = useState("");
  const [rating, setRating] = useState<number | null>(null);
  const [done, setDone] = useState(false);

  const mutation = useMutation({
    mutationFn: () => submitFeedback({ type, message, rating }),
    onSuccess: () => {
      setDone(true);
      setMessage("");
      setRating(null);
      setType("general");
      qc.invalidateQueries({ queryKey: ["feedback-submitted"] });
    },
  });

  return (
    <Layout>
      <div className="max-w-2xl mx-auto space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <MessageSquare className="h-7 w-7 text-primary" /> Send Feedback
          </h1>
          <p className="text-muted-foreground mt-1">
            Signed in as <span className="font-medium">{username}</span>. Share bugs, ideas, or kudos with the team.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-semibold">Your message</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {done && (
              <div className="rounded-md border border-green-500/30 bg-green-500/10 px-3 py-2 text-sm text-green-700 dark:text-green-400">
                Thanks! Your feedback was submitted and is pending review.
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="type">Type</Label>
              <Select value={type} onValueChange={setType}>
                <SelectTrigger id="type">
                  <SelectValue placeholder="Select a type" />
                </SelectTrigger>
                <SelectContent>
                  {TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="rating">Rating (optional)</Label>
              <div className="flex items-center gap-1">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setRating(n)}
                    className="focus:outline-none"
                    aria-label={`Rate ${n}`}
                  >
                    <Star
                      className={
                        "h-6 w-6 transition-colors " +
                        (rating !== null && n <= rating
                          ? "fill-yellow-400 text-yellow-400"
                          : "text-muted-foreground hover:text-yellow-400")
                      }
                    />
                  </button>
                ))}
                {rating !== null && (
                  <button
                    type="button"
                    onClick={() => setRating(null)}
                    className="ml-2 text-xs text-muted-foreground hover:text-foreground"
                  >
                    Clear
                  </button>
                )}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="message">Message</Label>
              <Textarea
                id="message"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Tell us what's on your mind…"
                className="min-h-[140px]"
                maxLength={5000}
              />
              <p className="text-xs text-muted-foreground text-right">{message.length}/5000</p>
            </div>

            <Button
              onClick={() => mutation.mutate()}
              disabled={mutation.isPending || !message.trim()}
              className="w-full sm:w-auto"
            >
              {mutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-1 animate-spin" /> Submitting…
                </>
              ) : (
                "Submit feedback"
              )}
            </Button>
            {mutation.isError && (
              <p className="text-sm text-destructive">{(mutation.error as Error).message}</p>
            )}
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}
