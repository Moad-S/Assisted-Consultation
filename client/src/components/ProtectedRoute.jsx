import { Navigate } from "react-router-dom";
import { auth } from "../auth";

export default function ProtectedRoute({ children, role }) {
  const t = auth.token();
  const r = auth.role();
  if (!t) return <Navigate to="/login/patient" replace />;
  if (role && r !== role) return <Navigate to="/" replace />;
  return children;
}
