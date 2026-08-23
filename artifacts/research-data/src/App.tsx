import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Suspense, lazy } from "react";
import { AnimatePresence, MotionConfig, motion } from "framer-motion";
import { useLocation } from "wouter";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { ProductTour } from "@/components/product-tour";
import { EASE_OUT } from "@/lib/motion";

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
const MoreFeatures = lazy(() => import("@/pages/more-features"));
const Consent = lazy(() => import("@/pages/consent"));
const Deidentify = lazy(() => import("@/pages/deidentify"));
const Coding = lazy(() => import("@/pages/coding"));
const Cohort = lazy(() => import("@/pages/cohort"));
const ValidationPage = lazy(() => import("@/pages/validation"));
const Dicom = lazy(() => import("@/pages/dicom"));
const ExportPage = lazy(() => import("@/pages/export"));
const Studies = lazy(() => import("@/pages/studies"));
const Ml = lazy(() => import("@/pages/ml"));
const Reports = lazy(() => import("@/pages/reports"));
const Gdpr = lazy(() => import("@/pages/gdpr"));
const Ingest = lazy(() => import("@/pages/ingest"));
const SearchPage = lazy(() => import("@/pages/search"));
const DataAnalysis = lazy(() => import("@/pages/data-analysis"));

function LoadingSpinner() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <Loader2 className="h-8 w-8 animate-spin text-primary" />
    </div>
  );
}

function AnimatedRoutes({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={location}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -8 }}
        transition={{ duration: 0.28, ease: EASE_OUT }}
      >
        <Suspense fallback={<LoadingSpinner />}>{children}</Suspense>
      </motion.div>
    </AnimatePresence>
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
      <AnimatedRoutes>
        <Switch>
          <Route path="/signup" component={Signup} />
          <Route component={Login} />
        </Switch>
      </AnimatedRoutes>
    );
  }

  return (
    <>
      <AnimatedRoutes>
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
        <Route path="/more-features" component={MoreFeatures} />
        <Route path="/consent" component={Consent} />
        <Route path="/deidentify" component={Deidentify} />
        <Route path="/coding" component={Coding} />
        <Route path="/cohort" component={Cohort} />
        <Route path="/validation" component={ValidationPage} />
        <Route path="/dicom" component={Dicom} />
        <Route path="/export" component={ExportPage} />
        <Route path="/studies" component={Studies} />
        <Route path="/ml" component={Ml} />
        <Route path="/reports" component={Reports} />
        <Route path="/gdpr" component={Gdpr} />
        <Route path="/ingest" component={Ingest} />
        <Route path="/search" component={SearchPage} />
        <Route path="/data-analysis" component={DataAnalysis} />
        <Route component={NotFound} />
      </Switch>
      </AnimatedRoutes>
    <ProductTour />
    </>
  );
}

function App() {
  return (
    <MotionConfig reducedMotion="user">
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
            <ProtectedRoutes />
          </WouterRouter>
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </MotionConfig>
  );
}

export default App;
