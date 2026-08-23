import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useI18n } from "../i18n";
import { Card, Button, Input } from "../components/ui";
import { apiPost, ApiError } from "../lib/api";

export default function Signup() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    try {
      await apiPost("/api/auth/signup", { username, password, reason });
      setDone(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Sign-up failed.");
    }
  };

  if (done) {
    return (
      <div className="mx-auto mt-16 max-w-sm">
        <Card>
          <p className="text-sm">Your request is awaiting admin approval. You will be notified once approved.</p>
          <Button className="mt-3" onClick={() => navigate("/login")}>{t("login")}</Button>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto mt-16 max-w-sm">
      <Card>
        <h1 className="mb-4 text-lg font-semibold">Sign up</h1>
        <form onSubmit={submit} className="space-y-3">
          <Input placeholder={t("username")} value={username} onChange={(e) => setUsername(e.target.value)} />
          <Input type="password" placeholder={t("password")} value={password} onChange={(e) => setPassword(e.target.value)} />
          <Input placeholder="Reason" value={reason} onChange={(e) => setReason(e.target.value)} />
          {error && <div className="text-sm text-red-600">{error}</div>}
          <Button type="submit" className="w-full">Request access</Button>
        </form>
      </Card>
    </div>
  );
}
