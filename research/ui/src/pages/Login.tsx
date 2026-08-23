import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { useI18n } from "../i18n";
import { Card, Button, Input } from "../components/ui";
import { ApiError } from "../lib/api";

export default function Login() {
  const { login } = useAuth();
  const { t } = useI18n();
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    try {
      await login(username, password);
      navigate("/");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Login failed.");
    }
  };

  return (
    <div className="mx-auto mt-16 max-w-sm">
      <Card>
        <h1 className="mb-4 text-lg font-semibold">{t("signIn")}</h1>
        <form onSubmit={submit} className="space-y-3">
          <Input placeholder={t("username")} value={username} onChange={(e) => setUsername(e.target.value)} />
          <Input type="password" placeholder={t("password")} value={password} onChange={(e) => setPassword(e.target.value)} />
          {error && <div className="text-sm text-red-600">{error}</div>}
          <Button type="submit" className="w-full">{t("signIn")}</Button>
        </form>
      </Card>
    </div>
  );
}
