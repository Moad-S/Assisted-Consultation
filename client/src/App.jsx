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

// Layout with global nav + Sign out + Dashboard link when logged in
function Layout({ children }) {
  const nav = useNavigate();
  const [, setTick] = useState(0); // force rerender after sign out
  const loggedIn = auth.isLoggedIn();
  const role = auth.role();

  function signOut() {
    auth.clear();
    setTick((t) => t + 1);
    nav("/", { replace: true });
  }

  const dashboardHref = role === "doctor" ? "/doctor" : "/patient";

  return (
    <div style={{ fontFamily: "system-ui", padding: 24 }}>
      <nav style={{ marginBottom: 16 }}>
        <Link to="/">Home</Link>
        {!loggedIn ? (
          <>
            {" · "}
            <Link to="/login/patient">Patient login</Link>
            {" · "}
            <Link to="/login/doctor">Doctor login</Link>
            {" · "}
            <Link to="/signup">Create account</Link>
          </>
        ) : (
          <>
            {" · "}
            <span style={{ opacity: 0.8 }}>
              Signed in as <strong>{role}</strong>
            </span>
            {" · "}
            <Link to={dashboardHref}>Go to {role} dashboard</Link>
            {" · "}
            <button
              onClick={signOut}
              style={{
                border: "1px solid #444",
                background: "#222",
                color: "#fff",
                padding: "4px 8px",
                borderRadius: 8,
                cursor: "pointer",
                marginLeft: 4,
              }}
            >
              Sign out
            </button>
          </>
        )}
      </nav>
      {children}
    </div>
  );
}

function Home() {
  const [apiMsg, setApiMsg] = useState("...loading");
  const loggedIn = auth.isLoggedIn();
  const role = auth.role();
  const dashboardHref = role === "doctor" ? "/doctor" : "/patient";

  useEffect(() => {
    fetch("/api/hello")
      .then((r) => r.json())
      .then((d) => setApiMsg(d.message))
      .catch(() => setApiMsg("API not reachable"));
  }, []);

  return (
    <Layout>
      <h1>Hello World / Homepage</h1>
      <p>This is your React front page.</p>

      {loggedIn && (
        <p style={{ marginTop: 12 }}>
          <Link
            to={dashboardHref}
            style={{
              display: "inline-block",
              border: "1px solid #444",
              background: "#222",
              color: "#fff",
              padding: "6px 10px",
              borderRadius: 8,
            }}
          >
            Open {role} dashboard
          </Link>
        </p>
      )}

      <hr />
      <p>
        <strong>Express says:</strong> {apiMsg}
      </p>
    </Layout>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />

        {/* Auth pages */}
        <Route
          path="/login/:who"
          element={
            <Layout>
              <Login />
            </Layout>
          }
        />
        <Route
          path="/signup"
          element={
            <Layout>
              <Signup />
            </Layout>
          }
        />

        {/* Protected areas */}
        <Route
          path="/patient"
          element={
            <ProtectedRoute role="patient">
              <Layout>
                <PatientHome />
              </Layout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/doctor"
          element={
            <ProtectedRoute role="doctor">
              <Layout>
                <DoctorHome />
              </Layout>
            </ProtectedRoute>
          }
        />

        {/* Fallback */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
