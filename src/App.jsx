import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { LiveDataProvider, useLiveData } from "./context/LiveDataContext.jsx";
import { DialogProvider } from "./context/DialogContext.jsx";
import { preferencesStore } from "./lib/dashboardPrefs.js";
import Login from "./components/Login.jsx";
import Layout from "./components/Layout.jsx";
import Dashboard from "./pages/Dashboard.jsx";
import ActionCenter from "./pages/ActionCenter.jsx";
import Endpoints from "./pages/Endpoints.jsx";
import DeviceDetail from "./pages/DeviceDetail.jsx";
import Infrastructure from "./pages/Infrastructure.jsx";
import DataCenters from "./pages/DataCenters.jsx";
import Alerts from "./pages/Alerts.jsx";
import Incidents from "./pages/Incidents.jsx";
import IncidentDetail from "./pages/IncidentDetail.jsx";
import Approvals from "./pages/Approvals.jsx";
import Lifecycle from "./pages/Lifecycle.jsx";
import HardwareIntegrity from "./pages/HardwareIntegrity.jsx";
import AiIntelligence from "./pages/AiIntelligence.jsx";
import ESG from "./pages/ESG.jsx";
import HelpDesk from "./pages/HelpDesk.jsx";
import Reports from "./pages/Reports.jsx";
import RemoteAssist from "./pages/RemoteAssist.jsx";
import Settings from "./pages/Settings.jsx";

// Real, genuinely applied preference - the root route reads the real stored landing-page choice
// and actually redirects, rather than storing a value the app never reads back. Dashboard renders
// directly (no redirect hop) when the preference is unset or already "/", the default.
function LandingRedirect() {
  const [prefs] = preferencesStore.useStore();
  if (prefs.landingPage && prefs.landingPage !== "/") {
    return <Navigate to={prefs.landingPage} replace />;
  }
  return <Dashboard />;
}

function Gate() {
  const { token } = useLiveData();
  if (!token) return <Login />;

  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<LandingRedirect />} />
          <Route path="/action-center" element={<ActionCenter />} />
          <Route path="/endpoints" element={<Endpoints />} />
          <Route path="/endpoints/:id" element={<DeviceDetail />} />
          <Route path="/infrastructure" element={<Infrastructure />} />
          <Route path="/data-centers" element={<DataCenters />} />
          <Route path="/alerts" element={<Alerts />} />
          <Route path="/incidents" element={<Incidents />} />
          <Route path="/incidents/:id" element={<IncidentDetail />} />
          <Route path="/approvals" element={<Approvals />} />
          <Route path="/lifecycle" element={<Lifecycle />} />
          <Route path="/hardware-integrity" element={<HardwareIntegrity />} />
          <Route path="/ai-intelligence" element={<AiIntelligence />} />
          <Route path="/esg" element={<ESG />} />
          <Route path="/help-desk" element={<HelpDesk />} />
          <Route path="/reports" element={<Reports />} />
          <Route path="/remote-assist" element={<RemoteAssist />} />
          <Route path="/settings" element={<Settings />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
  
export default function App() {
  return (
    <LiveDataProvider>
      <DialogProvider>
        <Gate />
      </DialogProvider>
    </LiveDataProvider>
  );
}
