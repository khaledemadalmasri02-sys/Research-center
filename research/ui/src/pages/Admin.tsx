import { useEffect, useState } from "react";
import { useAuth, canAdmin } from "../auth/AuthContext";
import { useI18n } from "../i18n";
import { apiGet, apiPost, apiPatch, apiDelete, ApiError } from "../lib/api";
import { Card, Button, Input, Select, Table, Badge } from "../components/ui";

type User = {
  id: number;
  username: string;
  fullName: string | null;
  email: string | null;
  role: string;
  canAdminAccess: boolean;
  status: string;
  createdAt: string;
};

type Signup = {
  id: number;
  username: string;
  fullName: string;
  email: string;
  reason: string;
  status: string;
  createdAt: string;
};

type Metrics = {
  users: number;
  records: number;
  recordDefinitions: number;
  feedback: number;
  signupRequests: number;
  notifications: number;
  uptime: number;
};

export default function Admin() {
  const { user } = useAuth();
  const { t } = useI18n();
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [signups, setSignups] = useState<Signup[]>([]);
  const [error, setError] = useState("");

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("viewer");
  const [canAdminAccess, setCanAdminAccess] = useState(false);
  const [backupMsg, setBackupMsg] = useState("");

  const reload = async () => {
    setError("");
    try {
      const [m, u, s] = await Promise.all([
        apiGet<Metrics>("/api/metrics").catch(() => null),
        apiGet<{ users: User[] }>("/api/admin/users").catch(() => ({ users: [] })),
        apiGet<{ requests: Signup[] }>("/api/admin/signup-requests").catch(() => ({ requests: [] })),
      ]);
      if (m) setMetrics(m);
      setUsers(u.users || []);
      setSignups((s.requests || []).filter((r) => r.status === "pending"));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed.");
    }
  };

  useEffect(() => { if (canAdmin(user)) reload(); /* eslint-disable-next-line */ }, [user]);

  if (!canAdmin(user)) return <div className="text-sm text-slate-500">Admin only.</div>;

  const createUser = async () => {
    setError("");
    if (!username || !password) return setError("username and password required.");
    try {
      await apiPost("/api/admin/users", {
        username, password, fullName: fullName || undefined, email: email || undefined, role, canAdminAccess,
      });
      setUsername(""); setPassword(""); setFullName(""); setEmail(""); setRole("viewer"); setCanAdminAccess(false);
      reload();
    } catch (e) { setError(e instanceof ApiError ? e.message : "Failed."); }
  };

  const updateUser = async (id: number, patch: Record<string, unknown>) => {
    setError("");
    try { await apiPatch(`/api/admin/users/${id}`, patch); reload(); }
    catch (e) { setError(e instanceof ApiError ? e.message : "Failed."); }
  };

  const deleteUser = async (id: number) => {
    if (id === user?.id) return setError("Cannot delete yourself.");
    if (!confirm("Delete this user?")) return;
    setError("");
    try { await apiDelete(`/api/admin/users/${id}`); reload(); }
    catch (e) { setError(e instanceof ApiError ? e.message : "Failed."); }
  };

  const reviewSignup = async (id: number, approve: boolean, reason?: string) => {
    setError("");
    try {
      await apiPost(`/api/admin/signup/${id}/${approve ? "approve" : "reject"}`, { reason });
      reload();
    } catch (e) { setError(e instanceof ApiError ? e.message : "Failed."); }
  };

  const backup = async () => {
    setBackupMsg("");
    const d = await apiPost<{ message: string }>("/api/admin/backup").catch(() => null);
    setBackupMsg(d?.message || "Backup request sent.");
  };

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">{t("navAdmin")}</h1>
      {error && <div className="rounded-lg bg-red-100 px-3 py-2 text-sm text-red-700">{error}</div>}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {metrics && (
          <>
            <Stat label="Users" value={metrics.users} />
            <Stat label="Records" value={metrics.records} />
            <Stat label="Definitions" value={metrics.recordDefinitions} />
            <Stat label="Feedback" value={metrics.feedback} />
            <Stat label="Signups" value={metrics.signupRequests} />
            <Stat label="Uptime (s)" value={metrics.uptime} />
          </>
        )}
      </div>

      <Card>
        <h2 className="mb-2 font-medium">Create user</h2>
        <div className="flex flex-wrap items-end gap-2">
          <Input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Username" />
          <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password" />
          <Input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Full name" />
          <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" />
          <Select value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="viewer">viewer</option>
            <option value="editor">editor</option>
            <option value="admin">admin</option>
          </Select>
          <label className="flex items-center gap-1 text-sm"><input type="checkbox" checked={canAdminAccess} onChange={(e) => setCanAdminAccess(e.target.checked)} /> Admin access</label>
          <Button onClick={createUser}>Create</Button>
        </div>
      </Card>

      <Card>
        <h2 className="mb-2 font-medium">Users</h2>
        <Table
          headers={["ID", "Username", "Name", "Role", "Status", "Admin", ""]}
          rows={users.map((u) => [
            u.id,
            u.username,
            u.fullName || "—",
            <Select key={"r" + u.id} value={u.role} onChange={(e) => updateUser(u.id, { role: e.target.value })}>
              <option value="viewer">viewer</option>
              <option value="editor">editor</option>
              <option value="admin">admin</option>
            </Select>,
            <Select key={"s" + u.id} value={u.status} onChange={(e) => updateUser(u.id, { status: e.target.value })}>
              <option value="active">active</option>
              <option value="pending">pending</option>
              <option value="suspended">suspended</option>
            </Select>,
            u.canAdminAccess ? <Badge key={"a" + u.id}>yes</Badge> : "no",
            <Button key={"d" + u.id} variant="danger" disabled={u.id === user?.id} onClick={() => deleteUser(u.id)}>Delete</Button>,
          ])}
        />
      </Card>

      <Card>
        <h2 className="mb-2 font-medium">Pending sign-up requests</h2>
        {signups.length === 0 && <p className="text-sm text-slate-500">None.</p>}
        <Table
          headers={["ID", "Username", "Name", "Email", "Reason", ""]}
          rows={signups.map((s) => [
            s.id, s.username, s.fullName, s.email, s.reason,
            <div key={"x" + s.id} className="flex gap-1">
              <Button onClick={() => reviewSignup(s.id, true)}>Approve</Button>
              <Button variant="danger" onClick={() => reviewSignup(s.id, false)}>Reject</Button>
            </div>,
          ])}
        />
      </Card>

      <Card>
        <h2 className="mb-2 font-medium">Backups</h2>
        <Button variant="secondary" onClick={backup}>Trigger backup</Button>
        {backupMsg && <p className="mt-2 text-sm">{backupMsg}</p>}
      </Card>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-slate-200 p-3">
      <div className="text-xs uppercase text-slate-500">{label}</div>
      <div className="text-lg font-semibold">{value}</div>
    </div>
  );
}
