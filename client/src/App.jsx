// client/src/App.jsx
import { useEffect, useState } from "react";
import { BrowserRouter, Routes, Route, Link, Navigate } from "react-router-dom";
import ProtectedRoute from "./components/ProtectedRoute";
import Login from "./pages/login";
import PatientHome from "./pages/patienthome";
import DoctorHome from "./pages/doctorhome";
import Signup from "./pages/signup"; // ← if your file is named Signup.jsx, adjust to "./pages/Signup"

function Layout({ children }) {
  return (
    <div style={{ fontFamily: "system-ui", padding: 24 }}>
      {/* Simple top nav on every page */}
      <nav style={{ marginBottom: 16 }}>
        <Link to="/">Home</Link> ·{" "}
        <Link to="/login/patient">Patient login</Link> ·{" "}
        <Link to="/login/doctor">Doctor login</Link> ·{" "}
        <Link to="/signup">Create account</Link>
      </nav>
      {children}
    </div>
  );
}

function Home() {
  const [apiMsg, setApiMsg] = useState("...loading");
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
