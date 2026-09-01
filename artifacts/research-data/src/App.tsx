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
import { isDesktopMode } from "@/lib/desktop-mode";
import {
  Home,
  Patients,
  Login,
  Signup,
  Database,
  Admin,
  Collections,
  RecordDefinitionEdit,
  RecordList,
  RecordDetail,
  PatientRecordView,
  PatientRecordFormPage,
  NewRecordPage,
  Feedback,
  Activity,
  ActivityMe,
  ApiTokens,
  Sessions,
  NotFound,
  MoreFeatures,
  Consent,
  Deidentify,
  Coding,
  Cohort,
  ValidationPage,
  Dicom,
  ExportPage,
  Studies,
  Ml,
  Reports,
  Gdpr,
  Ingest,
  SearchPage,
  DataAnalysis,
} from "@/components/desktop/app-registry";

const queryClient = new QueryClient();

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

function ClassicApp({ canAdminAccess }: { canAdminAccess: boolean }) {
  return (
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
  );
}

function DesktopApp() {
  const Desktop = lazy(() => import("@/components/desktop/Desktop"));
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-[radial-gradient(120%_120%_at_25%_15%,#6d28d9_0%,#3b0a6b_45%,#1b0635_100%)]">
          <Loader2 className="h-8 w-8 animate-spin text-white/80" />
        </div>
      }
    >
      <Desktop />
    </Suspense>
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
      {isDesktopMode() ? (
        <DesktopApp />
      ) : (
        <ClassicApp canAdminAccess={canAdminAccess} />
      )}
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
