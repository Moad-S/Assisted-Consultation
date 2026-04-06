import { Navigate } from "react-router-dom";
import { auth } from "../auth";

export default function ProtectedRoute({ role, children }) {
  if (!auth.isLoggedIn()) {
    if (role === "doctor") return <Navigate to="/login/doctor" replace />;
    if (role === "patient") return <Navigate to="/login/patient" replace />;
    return <Navigate to="/" replace />;
  }

  const r = auth.role();
  if (role && r !== role) {
    return <Navigate to="/" replace />;
  }

  return children;
}
