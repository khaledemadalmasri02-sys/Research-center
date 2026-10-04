import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Layout } from "@/components/layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { KeyRound, Copy, Trash2, Check, Loader2 } from "lucide-react";
import { useSound } from "@/components/sound-provider";
import { FadeIn, StaggeredItem, StaggeredList } from "@/lib/page-motion";
import { CrossFade } from "@/lib/page-motion";
import { ErrorState, NoDataState } from "@/components/ui/states";

/**
 * `admin` is deliberately absent. The server now rejects the `admin` scope
 * with 403 + an `api_token.create.denied` audit entry unless the requester
 * already has `canAdminAccess`, and `lib/apiToken.ts` computes
 * `canAdmin = hasAdminScope && user.canAdminAccess` so a token can never
 * out-privilege its owner. Offering the tick box to a non-admin just produced
 * a 403 with no explanation.
 */
const SCOPES = ["read", "write", "records:read", "records:write", "feedback:read", "feedback:write"];

interface TokenRow {
  id: number;
  name: string;
  scopes: string[];
  lastUsedAt: string | null;
  createdAt: string;
  revokedAt: string | null;
}

export default function ApiTokens() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<string[]>(["records:read"]);
  const [createdToken, setCreatedToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const { play } = useSound();

  const { data, isLoading, isError, error, refetch } = useQuery<{ tokens: TokenRow[] }>({
    queryKey: ["api-tokens"],
    queryFn: async () => {
      const res = await fetch("/api/tokens", { credentials: "include" });
      if (!res.ok) throw new Error(t("tokens.loadFailed"));
      return res.json();
    },
    retry: false,
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/tokens", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, scopes }),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error((b as { error?: string }).error ?? t("tokens.createFailed"));
      }
      return res.json() as Promise<{ token: string }>;
    },
    onSuccess: (r) => {
      setCreatedToken(r.token);
      setCopied(false);
      setName("");
      setScopes(["records:read"]);
      qc.invalidateQueries({ queryKey: ["api-tokens"] });
    },
  });

  const revokeMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/tokens/${id}`, { method: "DELETE", credentials: "include" });
      if (!res.ok) throw new Error(t("tokens.revokeFailed"));
      return res.json();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["api-tokens"] }),
  });

  const toggleScope = (s: string) =>
    setScopes((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]));

  const rows = data?.tokens ?? [];

  return (
    <Layout>
      <div className="max-w-3xl mx-auto space-y-6">
        <FadeIn>
          <div>
            <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
              <KeyRound className="h-7 w-7 text-primary" aria-hidden /> {t("tokens.title")}
            </h1>
            <p className="text-muted-foreground mt-1">{t("tokens.subtitle")}</p>
          </div>
        </FadeIn>

        <FadeIn delay={0.05}>
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-semibold">{t("tokens.create")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1">
                {/* Was placeholder-only: a placeholder is not an accessible name
                    and it disappears the moment the field is focused. */}
                <Label htmlFor="api-token-name">{t("tokens.nameLabel")}</Label>
                <Input
                  id="api-token-name"
                  placeholder={t("tokens.name")}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
              <div
                role="group"
                aria-labelledby="api-token-scopes-label"
                className="flex flex-wrap gap-2"
              >
                <span id="api-token-scopes-label" className="sr-only">
                  {t("tokens.scopesLabel")}
                </span>
                {SCOPES.map((s) => (
                  <button key={s} type="button" onClick={() => toggleScope(s)} aria-pressed={scopes.includes(s)}>
                    <Badge variant={scopes.includes(s) ? "default" : "outline"} className="cursor-pointer">
                      {s}
                    </Badge>
                  </button>
                ))}
              </div>
              <Button
                onClick={() => createMutation.mutate()}
                disabled={createMutation.isPending || !name.trim() || scopes.length === 0}
              >
                {createMutation.isPending && <Loader2 className="me-1 h-4 w-4 animate-spin" aria-hidden />}
                {t("tokens.create")}
              </Button>

              {createdToken && (
                <div
                  role="status"
                  aria-live="polite"
                  className="rounded-md border border-green-500/30 bg-green-500/10 p-3 space-y-2"
                >
                  <p className="text-sm text-green-700 dark:text-green-400">{t("tokens.created")}</p>
                  <div className="flex items-center gap-2">
                    <code className="text-xs break-all flex-1 rounded bg-background px-2 py-1">
                      {createdToken}
                    </code>
                    <Button
                      size="sm"
                      variant="outline"
                      aria-label={t("tokens.copyLabel")}
                      title={t("tokens.copyLabel")}
                      onClick={() => {
                        void navigator.clipboard.writeText(createdToken);
                        setCopied(true);
                        play("clipboard");
                      }}
                    >
                      {copied ? (
                        <Check className="h-4 w-4" aria-hidden />
                      ) : (
                        <Copy className="h-4 w-4" aria-hidden />
                      )}
                    </Button>
                  </div>
                </div>
              )}
              {createMutation.isError && (
                <p role="alert" className="text-sm text-destructive">
                  {(createMutation.error as Error).message}
                </p>
              )}
            </CardContent>
          </Card>
        </FadeIn>

        <FadeIn delay={0.05}>
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-semibold">{t("tokens.title")}</CardTitle>
            </CardHeader>
            <CardContent>
              {isError ? (
                <ErrorState
                  title={t("common.errorTitle")}
                  description={(error as Error)?.message ?? t("tokens.loadFailed")}
                  action={
                    <Button size="sm" variant="outline" onClick={() => void refetch()}>
                      {t("common.retry")}
                    </Button>
                  }
                />
              ) : (
                <CrossFade
                  loading={isLoading}
                  label={t("common.loading")}
                  skeleton={<div className="h-32 w-full animate-pulse bg-muted/40 rounded-md" />}
                >
                  {rows.length === 0 ? (
                    <NoDataState title={t("tokens.none")} size="sm" />
                  ) : (
                    <StaggeredList className="space-y-2">
                      {rows.map((tok, i) => (
                        <StaggeredItem key={tok.id} index={i}>
                          <div className="flex items-center justify-between gap-3 rounded-md border p-3">
                            <div className="min-w-0">
                              <p className="text-sm font-medium truncate">{tok.name}</p>
                              <div className="flex flex-wrap gap-1 mt-1">
                                {tok.scopes.map((s) => (
                                  <Badge key={s} variant="outline" className="text-xs">
                                    {s}
                                  </Badge>
                                ))}
                              </div>
                              <p className="text-xs text-muted-foreground mt-1">
                                {tok.revokedAt
                                  ? t("tokens.revoked")
                                  : tok.lastUsedAt
                                    ? t("tokens.usedAt", {
                                        date: new Date(tok.lastUsedAt).toLocaleString(),
                                      })
                                    : t("tokens.neverUsed")}
                              </p>
                            </div>
                            {!tok.revokedAt && (
                              <Button
                                size="sm"
                                variant="destructive"
                                aria-label={t("tokens.revokeLabel", { name: tok.name })}
                                title={t("tokens.revoke")}
                                onClick={() => revokeMutation.mutate(tok.id)}
                              >
                                <Trash2 className="h-4 w-4" aria-hidden />
                              </Button>
                            )}
                          </div>
                        </StaggeredItem>
                      ))}
                    </StaggeredList>
                  )}
                </CrossFade>
              )}
              {revokeMutation.isError && (
                <p role="alert" className="mt-2 text-sm text-destructive">
                  {(revokeMutation.error as Error).message}
                </p>
              )}
            </CardContent>
          </Card>
        </FadeIn>
      </div>
    </Layout>
  );
}
