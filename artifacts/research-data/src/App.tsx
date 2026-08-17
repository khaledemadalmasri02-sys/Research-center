import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Suspense, lazy } from "react";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";

const queryClient = new QueryClient();

const Home = lazy(() => import("@/pages/home"));
const Patients = lazy(() => import("@/pages/patients"));
const PatientNew = lazy(() => import("@/pages/patient-new"));
const PatientDetail = lazy(() => import("@/pages/patient-detail"));
const PatientEdit = lazy(() => import("@/pages/patient-edit"));
const Login = lazy(() => import("@/pages/login"));
const Database = lazy(() => import("@/pages/database"));
const NotFound = lazy(() => import("@/pages/not-found"));

function LoadingSpinner() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <Loader2 className="h-8 w-8 animate-spin text-primary" />
    </div>
  );
}

function ProtectedRoutes() {
  const { isLoading, authenticated } = useAuth();

  if (isLoading) {
    return <LoadingSpinner />;
  }

  if (!authenticated) {
    return (
      <Suspense fallback={<LoadingSpinner />}>
        <Login />
      </Suspense>
    );
  }

  return (
    <Suspense fallback={<LoadingSpinner />}>
      <Switch>
        <Route path="/" component={Home} />
        <Route path="/patients" component={Patients} />
        <Route path="/patients/new" component={PatientNew} />
        <Route path="/patients/:id/edit" component={PatientEdit} />
        <Route path="/patients/:id" component={PatientDetail} />
        <Route path="/database" component={Database} />
        <Route component={NotFound} />
      </Switch>
    </Suspense>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <ProtectedRoutes />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;