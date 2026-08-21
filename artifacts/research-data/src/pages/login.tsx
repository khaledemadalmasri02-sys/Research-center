import { useState } from "react";
import { Link } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Lock } from "lucide-react";

export default function Login() {
  const { login, isLoggingIn, loginError } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLocalError(null);
    try {
      await login({ username, password });
    } catch (err) {
      setLocalError((err as Error).message ?? "Invalid credentials");
    }
  }

  const error = localError ?? loginError;

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-teal-50 to-slate-100">
      <div className="w-full max-w-sm">
        <div className="bg-white rounded-2xl shadow-lg border p-8 space-y-6">
          <div className="text-center space-y-2">
            <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-teal-100 mb-2">
              <Lock className="w-6 h-6 text-teal-700" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight">MedResearch</h1>
            <p className="text-sm text-muted-foreground">Sign in to access patient records</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="username">Username</Label>
              <Input
                id="username"
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Enter your username"
                required
                disabled={isLoggingIn}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter your password"
                required
                disabled={isLoggingIn}
              />
            </div>

            {error && (
              <p className="text-sm text-destructive bg-destructive/10 rounded-md px-3 py-2">
                {error}
              </p>
            )}

            <Button type="submit" className="w-full" disabled={isLoggingIn}>
              {isLoggingIn && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {isLoggingIn ? "Signing in…" : "Sign in"}
            </Button>
          </form>

          <p className="text-center text-sm text-muted-foreground">
            Don't have an account?{" "}
            <Link href="/signup" className="text-primary font-medium hover:underline">
              Request access
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
