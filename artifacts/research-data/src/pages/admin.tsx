import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth } from "@/hooks/use-auth";
import { useLocation } from "wouter";
import { Loader2, Check, X, ShieldAlert, MessageSquare, Star, BarChart3, DatabaseBackup } from "lucide-react";
import { useEffect } from "react";

interface SignupRequest {
  id: number;
  username: string;
  fullName: string | null;
  email: string | null;
  reason: string | null;
  status: "pending" | "approved" | "rejected";
  createdAt: string;
}

interface UserRow {
  id: number;
  username: string;
  fullName: string | null;
  email: string | null;
  role: string;
  canAdminAccess: boolean;
  status: string;
  createdAt: string;
}

interface FeedbackRow {
  id: number;
  userId: number;
  username: string | null;
  type: string;
  message: string;
  rating: number | null;
  status: string;
  createdAt: string;
}

function useSignups() {
  return useQuery<{ requests: SignupRequest[] }>({
    queryKey: ["admin-signups"],
    queryFn: async () => {
      const res = await fetch("/api/signups", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load sign-up requests");
      return res.json();
    },
  });
}

function useUsers() {
  return useQuery<{ users: UserRow[] }>({
    queryKey: ["admin-users"],
    queryFn: async () => {
      const res = await fetch("/api/users", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load users");
      return res.json();
    },
  });
}

function useFeedback() {
  return useQuery<{ feedback: FeedbackRow[] }>({
    queryKey: ["admin-feedback"],
    queryFn: async () => {
      const res = await fetch("/api/feedback", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load feedback");
      return res.json();
    },
  });
}

function useMetrics() {
  return useQuery<{ uptime: number; counts: Record<string, number> }>({
    queryKey: ["admin-metrics"],
    queryFn: async () => {
      const res = await fetch("/api/metrics", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load metrics");
      return res.json();
    },
  });
}

function statusVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  if (status === "active") return "default";
  if (status === "suspended") return "destructive";
  if (status === "pending") return "secondary";
  return "outline";
}

export default function Admin() {
  const { canAdminAccess } = useAuth();
  const [, navigate] = useLocation();
  const qc = useQueryClient();

  useEffect(() => {
    if (!canAdminAccess) navigate("/");
  }, [canAdminAccess, navigate]);

  const signups = useSignups();
  const users = useUsers();
  const feedback = useFeedback();
  const metrics = useMetrics();

  const roleMutation = useMutation({
    mutationFn: async ({ id, role }: { id: number; role: string }) => {
      const res = await fetch(`/api/users/${id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role }),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error((b as any).error ?? "Failed");
      }
      return res.json();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-users"] }),
  });

  const backupMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/admin/backup`, { method: "POST", credentials: "include" });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error((b as any).error ?? "Backup failed");
      }
      return res.json();
    },
  });

  const reviewMutation = useMutation({
    mutationFn: async ({ id, action }: { id: number; action: "approve" | "reject" }) => {
      const res = await fetch(`/api/signups/${id}/${action}`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) throw new Error("Action failed");
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-signups"] });
      qc.invalidateQueries({ queryKey: ["admin-users"] });
    },
  });

  const userMutation = useMutation({
    mutationFn: async ({
      id,
      op,
      body,
    }: {
      id: number;
      op: "patch" | "delete";
      body?: Record<string, unknown>;
    }) => {
      const res = await fetch(`/api/users/${id}`, {
        method: op === "patch" ? "PATCH" : "DELETE",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error((b as any).error ?? "Action failed");
      }
      return res.json();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-users"] }),
  });

  const feedbackReviewMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/feedback/${id}/review`, {
        method: "PATCH",
        credentials: "include",
      });
      if (!res.ok) throw new Error("Action failed");
      return res.json();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-feedback"] }),
  });

  if (!canAdminAccess) return null;

  return (
    <Layout>
      <div className="max-w-5xl mx-auto space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <ShieldAlert className="h-7 w-7 text-primary" /> Admin Controller
          </h1>
          <p className="text-muted-foreground mt-1">Review sign-up requests and manage users.</p>
        </div>

        <Tabs defaultValue="signups">
          <TabsList>
            <TabsTrigger value="signups">Sign-up Requests</TabsTrigger>
            <TabsTrigger value="users">Users</TabsTrigger>
            <TabsTrigger value="feedback">Feedback</TabsTrigger>
            <TabsTrigger value="system">System</TabsTrigger>
          </TabsList>

          <TabsContent value="signups">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-semibold">Pending Applications</CardTitle>
              </CardHeader>
              <CardContent>
                {signups.isLoading ? (
                  <div className="flex justify-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin text-primary" />
                  </div>
                ) : signups.data?.requests.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-6 text-center">No sign-up requests.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Username</TableHead>
                          <TableHead>Name</TableHead>
                          <TableHead>Email</TableHead>
                          <TableHead>Reason</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead className="text-right">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {signups.data?.requests.map((r) => (
                          <TableRow key={r.id}>
                            <TableCell className="font-medium">{r.username}</TableCell>
                            <TableCell>{r.fullName ?? "—"}</TableCell>
                            <TableCell>{r.email ?? "—"}</TableCell>
                            <TableCell className="max-w-[200px] truncate">{r.reason ?? "—"}</TableCell>
                            <TableCell>
                              <Badge variant={statusVariant(r.status)}>{r.status}</Badge>
                            </TableCell>
                            <TableCell className="text-right space-x-2">
                              {r.status === "pending" && (
                                <>
                                  <Button
                                    size="sm"
                                    onClick={() => reviewMutation.mutate({ id: r.id, action: "approve" })}
                                  >
                                    <Check className="h-4 w-4 mr-1" /> Approve
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="destructive"
                                    onClick={() => reviewMutation.mutate({ id: r.id, action: "reject" })}
                                  >
                                    <X className="h-4 w-4 mr-1" /> Reject
                                  </Button>
                                </>
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="feedback">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-semibold">User Feedback</CardTitle>
              </CardHeader>
              <CardContent>
                {feedback.isLoading ? (
                  <div className="flex justify-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin text-primary" />
                  </div>
                ) : feedback.data?.feedback.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-6 text-center">No feedback submitted yet.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>User</TableHead>
                          <TableHead>Type</TableHead>
                          <TableHead>Rating</TableHead>
                          <TableHead>Message</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>Date</TableHead>
                          <TableHead className="text-right">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {feedback.data?.feedback.map((f) => (
                          <TableRow key={f.id}>
                            <TableCell className="font-medium">{f.username ?? "—"}</TableCell>
                            <TableCell>
                              <Badge variant="outline">{f.type}</Badge>
                            </TableCell>
                            <TableCell>
                              {f.rating ? (
                                <span className="inline-flex items-center gap-0.5">
                                  {f.rating}
                                  <Star className="h-3.5 w-3.5 fill-yellow-400 text-yellow-400" />
                                </span>
                              ) : (
                                "—"
                              )}
                            </TableCell>
                            <TableCell className="max-w-[320px] whitespace-pre-wrap">{f.message}</TableCell>
                            <TableCell>
                              <Badge variant={f.status === "reviewed" ? "default" : "secondary"}>{f.status}</Badge>
                            </TableCell>
                            <TableCell className="text-muted-foreground text-xs">
                              {new Date(f.createdAt).toLocaleString()}
                            </TableCell>
                            <TableCell className="text-right">
                              {f.status === "new" ? (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => feedbackReviewMutation.mutate(f.id)}
                                >
                                  Mark reviewed
                                </Button>
                              ) : (
                                <span className="text-xs text-muted-foreground">Reviewed</span>
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="users">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-semibold">All Users</CardTitle>
              </CardHeader>
              <CardContent>
                {users.isLoading ? (
                  <div className="flex justify-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin text-primary" />
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Username</TableHead>
                          <TableHead>Role</TableHead>
                          <TableHead>Admin</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead className="text-right">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {users.data?.users.map((u) => (
                          <TableRow key={u.id}>
                            <TableCell className="font-medium">{u.username}</TableCell>
                          <TableCell>
                            <Select
                              value={u.role}
                              onValueChange={(role) => roleMutation.mutate({ id: u.id, role })}
                            >
                              <SelectTrigger className="h-8 w-28">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="viewer">viewer</SelectItem>
                                <SelectItem value="editor">editor</SelectItem>
                                <SelectItem value="admin">admin</SelectItem>
                              </SelectContent>
                            </Select>
                          </TableCell>
                            <TableCell>{u.canAdminAccess ? "Yes" : "No"}</TableCell>
                            <TableCell>
                              <Badge variant={statusVariant(u.status)}>{u.status}</Badge>
                            </TableCell>
                            <TableCell className="text-right space-x-2">
                              {u.status === "active" ? (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => userMutation.mutate({ id: u.id, op: "patch", body: { status: "suspended" } })}
                                >
                                  Suspend
                                </Button>
                              ) : (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => userMutation.mutate({ id: u.id, op: "patch", body: { status: "active" } })}
                                >
                                  Activate
                                </Button>
                              )}
                              <Button
                                size="sm"
                                variant="destructive"
                                onClick={() => {
                                  if (confirm(`Delete user ${u.username}?`)) {
                                    userMutation.mutate({ id: u.id, op: "delete" });
                                  }
                                }}
                              >
                                Delete
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="system">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <BarChart3 className="h-4 w-4" /> System & Metrics
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {metrics.data &&
                    Object.entries(metrics.data.counts).map(([k, v]) => (
                      <div key={k} className="rounded-md border p-3">
                        <p className="text-xs text-muted-foreground capitalize">{k}</p>
                        <p className="text-2xl font-bold">{v}</p>
                      </div>
                    ))}
                </div>
                {metrics.data && (
                  <p className="text-xs text-muted-foreground">
                    Uptime: {Math.floor(metrics.data.uptime / 60)} min
                  </p>
                )}

                <div className="flex items-center gap-2">
                  <Button onClick={() => backupMutation.mutate()} disabled={backupMutation.isPending}>
                    <DatabaseBackup className="h-4 w-4 mr-1" />
                    {backupMutation.isPending ? "Backing up…" : "Run backup now"}
                  </Button>
                  {backupMutation.isSuccess && (
                    <span className="text-sm text-green-600">Saved: {backupMutation.data?.key}</span>
                  )}
                  {backupMutation.isError && (
                    <span className="text-sm text-destructive">{(backupMutation.error as Error).message}</span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  Backups are dumped with pg_dump and stored in the S3 bucket under <code>/backups/</code> (enable bucket versioning for retention).
                </p>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </Layout>
  );
}
