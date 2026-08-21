import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Loader2, KeyRound, Copy, Trash2, Check } from "lucide-react";
import { useTranslation } from "react-i18next";

const SCOPES = ["read", "write", "records:read", "records:write", "feedback:read", "feedback:write", "admin"];

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

  const { data, isLoading } = useQuery<{ tokens: TokenRow[] }>({
    queryKey: ["api-tokens"],
    queryFn: async () => {
      const res = await fetch("/api/tokens", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load tokens");
      return res.json();
    },
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
        throw new Error((b as any).error ?? "Failed to create token");
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
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["api-tokens"] }),
  });

  const toggleScope = (s: string) =>
    setScopes((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]));

  return (
    <Layout>
      <div className="max-w-3xl mx-auto space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <KeyRound className="h-7 w-7 text-primary" /> {t("tokens.title")}
          </h1>
          <p className="text-muted-foreground mt-1">{t("tokens.subtitle")}</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-semibold">New token</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Input placeholder={t("tokens.name")} value={name} onChange={(e) => setName(e.target.value)} />
            <div className="flex flex-wrap gap-2">
              {SCOPES.map((s) => (
                <button key={s} type="button" onClick={() => toggleScope(s)}>
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
              {createMutation.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : null}
              {t("tokens.create")}
            </Button>

            {createdToken && (
              <div className="rounded-md border border-green-500/30 bg-green-500/10 p-3 space-y-2">
                <p className="text-sm text-green-700 dark:text-green-400">{t("tokens.created")}</p>
                <div className="flex items-center gap-2">
                  <code className="text-xs break-all flex-1 rounded bg-background px-2 py-1">{createdToken}</code>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      void navigator.clipboard.writeText(createdToken);
                      setCopied(true);
                    }}
                  >
                    {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  </Button>
                </div>
              </div>
            )}
            {createMutation.isError && (
              <p className="text-sm text-destructive">{(createMutation.error as Error).message}</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-semibold">{t("tokens.title")}</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
              </div>
            ) : data && data.tokens.length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">{t("tokens.none")}</p>
            ) : (
              <div className="space-y-2">
                {data?.tokens.map((tok) => (
                  <div key={tok.id} className="flex items-center justify-between gap-3 rounded-md border p-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{tok.name}</p>
                      <div className="flex flex-wrap gap-1 mt-1">
                        {tok.scopes.map((s) => (
                          <Badge key={s} variant="outline" className="text-[10px]">
                            {s}
                          </Badge>
                        ))}
                      </div>
                      <p className="text-[11px] text-muted-foreground mt-1">
                        {tok.revokedAt ? "Revoked" : tok.lastUsedAt ? `Used ${new Date(tok.lastUsedAt).toLocaleString()}` : "Never used"}
                      </p>
                    </div>
                    {!tok.revokedAt && (
                      <Button size="sm" variant="destructive" onClick={() => revokeMutation.mutate(tok.id)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}
