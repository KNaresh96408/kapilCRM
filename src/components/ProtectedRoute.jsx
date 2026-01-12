import { useAuth } from "../context/AuthContext";
import { Navigate } from "react-router-dom";

export default function ProtectedRoute({ children }) {
  const { user } = useAuth();

  // If user is NOT logged in → force redirect to login page
  if (!user) return <Navigate to="/" replace />;

  return children;
}
