import { useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Link } from "wouter";
import { Loader2, CheckCircle2, UserPlus } from "lucide-react";

export default function Signup() {
  const { signup, isSigningUp, signupError } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [reason, setReason] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLocalError(null);
    try {
      await signup({ username, password, fullName, email, reason });
      setSubmitted(true);
    } catch (err) {
      setLocalError((err as Error).message ?? "Sign-up failed");
    }
  }

  if (submitted) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-teal-50 to-slate-100 p-4">
        <Card className="w-full max-w-md">
          <CardContent className="pt-6 text-center space-y-4">
            <CheckCircle2 className="h-12 w-12 text-emerald-600 mx-auto" />
            <h2 className="text-xl font-bold">Request submitted</h2>
            <p className="text-sm text-muted-foreground">
              Your sign-up request is pending admin approval. You'll be able to log in once an
              administrator confirms it (website access only).
            </p>
            <Button asChild className="w-full">
              <Link href="/login">Back to sign in</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const error = localError ?? signupError;

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-teal-50 to-slate-100 p-4">
      <div className="w-full max-w-sm">
        <div className="bg-white rounded-2xl shadow-lg border p-8 space-y-6">
          <div className="text-center space-y-2">
            <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-teal-100 mb-2">
              <UserPlus className="w-6 h-6 text-teal-700" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight">MedResearch</h1>
            <p className="text-sm text-muted-foreground">Request a new account</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="username">Username</Label>
              <Input
                id="username"
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Choose a username"
                required
                disabled={isSigningUp}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="At least 8 chars, letters + numbers"
                required
                disabled={isSigningUp}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="fullName">Full name (optional)</Label>
              <Input
                id="fullName"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Your name"
                disabled={isSigningUp}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="email">Email (optional)</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                disabled={isSigningUp}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="reason">Reason for access (optional)</Label>
              <Input
                id="reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Briefly describe your use"
                disabled={isSigningUp}
              />
            </div>

            {error && (
              <p className="text-sm text-destructive bg-destructive/10 rounded-md px-3 py-2">{error}</p>
            )}

            <Button type="submit" className="w-full" disabled={isSigningUp}>
              {isSigningUp && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {isSigningUp ? "Submitting…" : "Submit request"}
            </Button>
          </form>

          <p className="text-center text-sm text-muted-foreground">
            Already approved?{" "}
            <Link href="/login" className="text-primary font-medium hover:underline">
              Sign in
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
