import AuthPage from "@/pages/auth";

/**
 * `/login` entry point. The login and sign-up experiences live in a single
 * animated component (`@/pages/auth`); this route simply opens it in login mode.
 */
export default function Login() {
  return <AuthPage initialMode="login" />;
}
