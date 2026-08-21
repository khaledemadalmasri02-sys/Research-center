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
const Login = lazy(() => import("@/pages/login"));
const Signup = lazy(() => import("@/pages/signup"));
const Database = lazy(() => import("@/pages/database"));
const Admin = lazy(() => import("@/pages/admin"));
const Collections = lazy(() => import("@/pages/records"));
const RecordDefinitionEdit = lazy(() => import("@/pages/record-definition-edit"));
const RecordList = lazy(() => import("@/pages/record-list"));
const RecordDetail = lazy(() => import("@/pages/record-detail"));
const PatientRecordView = lazy(() => import("@/pages/patient-record-view"));
const PatientRecordFormPage = lazy(() => import("@/components/patient-record-form"));
const NewRecordPage = lazy(() => import("@/components/new-record-page"));
const Feedback = lazy(() => import("@/pages/feedback"));
const Activity = lazy(() => import("@/pages/activity"));
const ActivityMe = lazy(() => import("@/pages/activity-me"));
const ApiTokens = lazy(() => import("@/pages/api-tokens"));
const Sessions = lazy(() => import("@/pages/sessions"));
const NotFound = lazy(() => import("@/pages/not-found"));

function LoadingSpinner() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <Loader2 className="h-8 w-8 animate-spin text-primary" />
    </div>
  );
}

function ProtectedRoutes() {
  const { isLoading, authenticated, canAdminAccess } = useAuth();

  if (isLoading) {
    return <LoadingSpinner />;
  }

  // Public routes
  if (!authenticated) {
    return (
      <Suspense fallback={<LoadingSpinner />}>
        <Switch>
          <Route path="/signup" component={Signup} />
          <Route component={Login} />
        </Switch>
      </Suspense>
    );
  }

  return (
    <Suspense fallback={<LoadingSpinner />}>
      <Switch>
        <Route path="/" component={Home} />
        <Route path="/patients" component={Patients} />
        <Route path="/patients/new" component={NewRecordPage} />
        <Route path="/patients/:id" component={PatientRecordView} />
        <Route path="/patients/:id/edit" component={PatientRecordFormPage} />
        <Route path="/collections" component={Collections} />
        <Route path="/collections/new" component={RecordDefinitionEdit} />
        <Route path="/collections/:id/edit" component={RecordDefinitionEdit} />
        <Route path="/records/:definitionId" component={() => <RecordList />} />
        <Route path="/records/:definitionId/new" component={() => <RecordDetail />} />
        <Route path="/records/:definitionId/:recordId" component={() => <RecordDetail />} />
          <Route path="/feedback" component={Feedback} />
          <Route path="/activity/me" component={ActivityMe} />
          <Route path="/api-tokens" component={ApiTokens} />
          <Route path="/sessions" component={Sessions} />
          {canAdminAccess && <Route path="/database" component={Database} />}
          {canAdminAccess && <Route path="/activity" component={Activity} />}
        {canAdminAccess && <Route path="/admin" component={Admin} />}
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
