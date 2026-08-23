import { Routes, Route, Navigate } from "react-router-dom";
import { Layout } from "./components/Layout";
import { useAuth } from "./auth/AuthContext";
import Home from "./pages/Home";
import Login from "./pages/Login";
import Signup from "./pages/Signup";
import NotFound from "./pages/NotFound";
import Consent from "./pages/Consent";
import Deidentify from "./pages/Deidentify";
import Cohort from "./pages/Cohort";
import ValidationPage from "./pages/ValidationPage";
import Dicom from "./pages/Dicom";
import ExportPage from "./pages/ExportPage";
import Studies from "./pages/Studies";
import Ml from "./pages/Ml";
import Reports from "./pages/Reports";
import Gdpr from "./pages/Gdpr";
import Audit from "./pages/Audit";
import SearchPage from "./pages/SearchPage";
import Admin from "./pages/Admin";
import Activity from "./pages/Activity";

function RequireAuth({ children }: { children: JSX.Element }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="p-4">…</div>;
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Home />} />
        <Route path="/login" element={<Login />} />
        <Route path="/signup" element={<Signup />} />
        <Route path="/consent" element={<RequireAuth><Consent /></RequireAuth>} />
        <Route path="/deidentify" element={<RequireAuth><Deidentify /></RequireAuth>} />
        <Route path="/cohort" element={<RequireAuth><Cohort /></RequireAuth>} />
        <Route path="/validation" element={<RequireAuth><ValidationPage /></RequireAuth>} />
        <Route path="/dicom" element={<RequireAuth><Dicom /></RequireAuth>} />
        <Route path="/export" element={<RequireAuth><ExportPage /></RequireAuth>} />
        <Route path="/studies" element={<RequireAuth><Studies /></RequireAuth>} />
        <Route path="/ml" element={<RequireAuth><Ml /></RequireAuth>} />
        <Route path="/reports" element={<RequireAuth><Reports /></RequireAuth>} />
        <Route path="/gdpr" element={<RequireAuth><Gdpr /></RequireAuth>} />
        <Route path="/audit" element={<RequireAuth><Audit /></RequireAuth>} />
        <Route path="/search" element={<RequireAuth><SearchPage /></RequireAuth>} />
        <Route path="/activity" element={<RequireAuth><Activity /></RequireAuth>} />
        <Route path="/activity/me" element={<RequireAuth><Activity me /></RequireAuth>} />
        <Route path="/admin" element={<RequireAuth><Admin /></RequireAuth>} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
