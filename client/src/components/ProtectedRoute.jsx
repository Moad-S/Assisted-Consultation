// client/src/components/ProtectedRoute.jsx
import { Navigate } from "react-router-dom";
import { auth } from "../auth";

export default function ProtectedRoute({ role, children }) {
  // must have token, not expired
  if (!auth.isLoggedIn()) {
    // send to the right login page if I know which role is needed
    if (role === "doctor") return <Navigate to="/login/doctor" replace />;
    if (role === "patient") return <Navigate to="/login/patient" replace />;
    return <Navigate to="/" replace />;
  }

  // must match role
  const r = auth.role();
  if (role && r !== role) {
    // logged-in but wrong role goes home 
    return <Navigate to="/" replace />;
  }

  return children;
}
