// client/src/App.jsx
import { useEffect, useState } from "react";
import {
  BrowserRouter,
  Routes,
  Route,
  Link,
  Navigate,
  useNavigate,
} from "react-router-dom";
import ProtectedRoute from "./components/ProtectedRoute";
import Login from "./pages/login";
import PatientHome from "./pages/patienthome";
import DoctorHome from "./pages/doctorhome";
import Signup from "./pages/Signup";
import { auth } from "./auth";

function Layout({ children }) {
  const nav = useNavigate();
  const [, setTick] = useState(0);
  const loggedIn = auth.isLoggedIn();
  const role = auth.role();

  function signOut() {
    auth.clear();
    setTick((t) => t + 1);
    nav("/", { replace: true });
  }

  const dashboardHref = role === "doctor" ? "/doctor" : "/patient";

  return (
    <div className="min-h-screen bg-surface-alt">
      {/* Navigation */}
      <header className="bg-white border-b border-border shadow-sm sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <Link to="/" className="text-xl font-bold text-primary-700 hover:text-primary-800 transition-colors">
            Care AI
          </Link>

          <nav className="flex items-center gap-3">
            {!loggedIn ? (
              <>
                <Link to="/login/patient" className="text-sm font-medium text-slate-600 hover:text-primary-600 transition-colors">
                  Patient Login
                </Link>
                <Link to="/login/doctor" className="text-sm font-medium text-slate-600 hover:text-primary-600 transition-colors">
                  Doctor Login
                </Link>
                <Link to="/signup" className="bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors">
                  Sign Up
                </Link>
              </>
            ) : (
              <>
                <span className="text-sm text-text-muted">
                  Signed in as{" "}
                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-primary-100 text-primary-800 capitalize">
                    {role}
                  </span>
                </span>
                <Link
                  to={dashboardHref}
                  className="text-sm font-medium text-primary-600 hover:text-primary-700 transition-colors"
                >
                  Dashboard
                </Link>
                <button
                  onClick={signOut}
                  className="text-sm text-red-600 hover:text-red-700 hover:bg-red-50 px-3 py-1.5 rounded-md transition-colors cursor-pointer"
                >
                  Sign out
                </button>
              </>
            )}
          </nav>
        </div>
      </header>

      {/* Page content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {children}
      </main>
    </div>
  );
}

function Home() {
  const [apiMsg, setApiMsg] = useState("checking...");
  const [apiOk, setApiOk] = useState(null);
  const loggedIn = auth.isLoggedIn();
  const role = auth.role();
  const dashboardHref = role === "doctor" ? "/doctor" : "/patient";

  useEffect(() => {
    fetch("/api/hello")
      .then((r) => r.json())
      .then((d) => { setApiMsg(d.message); setApiOk(true); })
      .catch(() => { setApiMsg("API not reachable"); setApiOk(false); });
  }, []);

  return (
    <Layout>
      <div className="text-center max-w-2xl mx-auto py-12 sm:py-20">
        {/* Hero */}
        <h1 className="text-4xl sm:text-5xl font-bold text-primary-800 mb-4 tracking-tight">
          Care AI
        </h1>
        <p className="text-lg text-text-muted mb-10">
          Intelligent pre-consultation triage — helping patients and doctors connect faster.
        </p>

        {loggedIn ? (
          <Link
            to={dashboardHref}
            className="inline-flex items-center gap-2 bg-primary-600 hover:bg-primary-700 text-white font-medium px-6 py-3 rounded-xl shadow-sm transition-colors"
          >
            Open {role} dashboard
            <span aria-hidden="true">&rarr;</span>
          </Link>
        ) : (
          <>
            {/* Role cards */}
            <div className="flex flex-col sm:flex-row gap-4 justify-center mb-8">
              <Link
                to="/login/patient"
                className="flex-1 max-w-xs mx-auto sm:mx-0 bg-white border border-border rounded-xl p-6 hover:shadow-md hover:border-primary-300 transition-all text-center group"
              >
                <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-primary-100 text-primary-700 flex items-center justify-center text-xl font-bold">
                  P
                </div>
                <h3 className="text-lg font-semibold text-text group-hover:text-primary-700 transition-colors">
                  I'm a Patient
                </h3>
                <p className="text-sm text-text-muted mt-1">
                  Start your pre-consultation intake
                </p>
              </Link>

              <Link
                to="/login/doctor"
                className="flex-1 max-w-xs mx-auto sm:mx-0 bg-white border border-border rounded-xl p-6 hover:shadow-md hover:border-teal-500 transition-all text-center group"
              >
                <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-teal-100 text-teal-700 flex items-center justify-center text-xl font-bold">
                  D
                </div>
                <h3 className="text-lg font-semibold text-text group-hover:text-teal-700 transition-colors">
                  I'm a Doctor
                </h3>
                <p className="text-sm text-text-muted mt-1">
                  Review patient sessions &amp; notes
                </p>
              </Link>
            </div>

            <p className="text-sm text-text-muted">
              Don't have an account?{" "}
              <Link to="/signup" className="text-primary-600 hover:text-primary-700 font-medium">
                Create one here
              </Link>
            </p>
          </>
        )}

        {/* API status */}
        <div className="mt-12 flex items-center justify-center gap-2 text-sm text-text-muted">
          <span className={`w-2 h-2 rounded-full ${apiOk === true ? "bg-success" : apiOk === false ? "bg-danger" : "bg-warning"}`} />
          <span>Server: {apiMsg}</span>
        </div>
      </div>
    </Layout>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/login/:who" element={<Layout><Login /></Layout>} />
        <Route path="/signup" element={<Layout><Signup /></Layout>} />
        <Route
          path="/patient"
          element={
            <ProtectedRoute role="patient">
              <Layout><PatientHome /></Layout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/doctor"
          element={
            <ProtectedRoute role="doctor">
              <Layout><DoctorHome /></Layout>
            </ProtectedRoute>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
