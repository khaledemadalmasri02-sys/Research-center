import AuthPage from "@/pages/auth";

/**
 * `/signup` entry point. Shares the single animated auth component with
 * `/login`; this route simply opens it in sign-up mode.
 */
export default function Signup() {
  return <AuthPage initialMode="signup" />;
}
