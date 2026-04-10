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
    <div className="min-h-screen bg-canvas">
      <header className="bg-white/80 backdrop-blur-xl border-b border-border-subtle sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-5 sm:px-8 h-16 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2.5 group">
            <div className="w-8 h-8 rounded-lg bg-primary-600 flex items-center justify-center shadow-sm group-hover:shadow-md group-hover:scale-105 transition-all">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 12h-4l-3 9L9 3l-3 9H2"/>
              </svg>
            </div>
            <span className="font-display text-lg font-semibold text-ink tracking-tight">Care AI</span>
          </Link>

          <nav className="flex items-center gap-2">
            {!loggedIn ? (
              <>
                <Link to="/login/patient" className="text-sm font-medium text-ink-muted hover:text-ink px-3 py-2 rounded-lg hover:bg-canvas transition">
                  Patient
                </Link>
                <Link to="/login/doctor" className="text-sm font-medium text-ink-muted hover:text-ink px-3 py-2 rounded-lg hover:bg-canvas transition">
                  Doctor
                </Link>
                <Link to="/signup" className="bg-ink text-white text-sm font-medium px-4 py-2 rounded-full hover:bg-ink/85 transition shadow-sm hover:shadow-md">
                  Get Started
                </Link>
              </>
            ) : (
              <>
                <span className="text-sm text-ink-muted mr-1">
                  <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold tracking-wide uppercase
                    ${role === "doctor" ? "bg-doctor-soft text-doctor" : "bg-patient-soft text-patient"}`}>
                    {role}
                  </span>
                </span>
                <Link
                  to={dashboardHref}
                  className="text-sm font-medium text-ink-muted hover:text-ink px-3 py-2 rounded-lg hover:bg-canvas transition"
                >
                  Dashboard
                </Link>
                <button
                  onClick={signOut}
                  className="text-sm text-ink-muted hover:text-danger px-3 py-2 rounded-lg hover:bg-red-50 transition cursor-pointer"
                >
                  Sign out
                </button>
              </>
            )}
          </nav>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-5 sm:px-8 py-8">
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
      <div className="max-w-3xl mx-auto py-16 sm:py-28">
        <div className="text-center mb-16">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-primary-50 text-primary-700 text-xs font-semibold tracking-wide uppercase mb-6">
            <span className="w-1.5 h-1.5 rounded-full bg-primary-500 animate-pulse" />
            AI-Powered Triage
          </div>
          <h1 className="font-display text-5xl sm:text-6xl font-bold text-ink tracking-tight leading-[1.1] mb-5">
            Smarter patient<br />
            <span className="text-primary-600">intake</span>, faster care
          </h1>
          <p className="text-lg text-ink-muted max-w-xl mx-auto leading-relaxed">
            Intelligent pre-consultation triage that connects patients and doctors seamlessly, powered by AI.
          </p>
        </div>

        {loggedIn ? (
          <div className="flex justify-center">
            <Link
              to={dashboardHref}
              className="group inline-flex items-center gap-3 bg-ink text-white font-medium px-8 py-4 rounded-full shadow-lg hover:shadow-xl hover:bg-ink/90 transition-all"
            >
              Open {role} dashboard
              <svg className="w-4 h-4 group-hover:translate-x-1 transition-transform" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6"/></svg>
            </Link>
          </div>
        ) : (
          <>
            <div className="grid sm:grid-cols-2 gap-5 max-w-2xl mx-auto mb-10">
              <Link
                to="/login/patient"
                className="group relative bg-white rounded-2xl p-7 hover:shadow-lg transition-all border border-border hover:border-primary-300 overflow-hidden"
              >
                <div className="absolute top-0 right-0 w-32 h-32 bg-primary-50 rounded-bl-[80px] -mr-4 -mt-4 opacity-60 group-hover:opacity-100 transition-opacity" />
                <div className="relative">
                  <div className="w-12 h-12 mb-4 rounded-2xl bg-primary-100 text-primary-700 flex items-center justify-center">
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
                      <circle cx="12" cy="7" r="4"/>
                    </svg>
                  </div>
                  <h3 className="font-display text-lg font-semibold text-ink mb-1">
                    I'm a Patient
                  </h3>
                  <p className="text-sm text-ink-muted leading-relaxed">
                    Start your pre-consultation intake with our AI assistant
                  </p>
                </div>
              </Link>

              <Link
                to="/login/doctor"
                className="group relative bg-white rounded-2xl p-7 hover:shadow-lg transition-all border border-border hover:border-doctor/40 overflow-hidden"
              >
                <div className="absolute top-0 right-0 w-32 h-32 bg-doctor-soft rounded-bl-[80px] -mr-4 -mt-4 opacity-60 group-hover:opacity-100 transition-opacity" />
                <div className="relative">
                  <div className="w-12 h-12 mb-4 rounded-2xl bg-doctor-soft text-doctor flex items-center justify-center">
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M3 3v18h18"/><path d="M18 17V9"/><path d="M13 17V5"/><path d="M8 17v-3"/>
                    </svg>
                  </div>
                  <h3 className="font-display text-lg font-semibold text-ink mb-1">
                    I'm a Doctor
                  </h3>
                  <p className="text-sm text-ink-muted leading-relaxed">
                    Review patient sessions, notes &amp; profiles
                  </p>
                </div>
              </Link>
            </div>

            <p className="text-center text-sm text-ink-muted">
              New here?{" "}
              <Link to="/signup" className="text-primary-600 hover:text-primary-700 font-semibold underline underline-offset-2 decoration-primary-300 hover:decoration-primary-500 transition">
                Create an account
              </Link>
            </p>
          </>
        )}

        <div className="mt-16 flex items-center justify-center gap-2.5 text-sm text-ink-faint">
          <span className={`w-2 h-2 rounded-full ${apiOk === true ? "bg-success" : apiOk === false ? "bg-danger" : "bg-warning animate-pulse"}`} />
          <span>{apiMsg}</span>
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
