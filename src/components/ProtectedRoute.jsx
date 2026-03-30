import { useAuth } from "../context/AuthContext";
import { Navigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { FirebaseAuthentication } from '@capacitor-firebase/authentication';
import { Capacitor } from '@capacitor/core';

export default function ProtectedRoute({ children }) {
  const { user, loading } = useAuth();
  const [nativeChecking, setNativeChecking] = useState(false);
  const [nativeUser, setNativeUser] = useState(null);

  useEffect(() => {
    let mounted = true;

    const checkNative = async () => {
      if (!Capacitor.isNativePlatform()) {
        if (mounted) setNativeChecking(false);
        return;
      }

      // iOS: avoid native getCurrentUser keychain crash path; rely on web auth + kp-user session.
      if (Capacitor.getPlatform() === "ios") {
        if (mounted) {
          setNativeUser(null);
          setNativeChecking(false);
        }
        return;
      }

      if (user) {
        if (mounted) setNativeChecking(false);
        return;
      }

      if (mounted) setNativeChecking(true);

      try {
        const res = await FirebaseAuthentication.getCurrentUser();
        if (mounted) setNativeUser(res?.user ?? null);
      } catch (err) {
        console.warn("⚠️ Native auth check failed", err);
      } finally {
        if (mounted) setNativeChecking(false);
      }
    };

    checkNative();

    return () => {
      mounted = false;
    };
  }, [user]);

  if (loading || nativeChecking) return null;

  const hasLocalSession = !!localStorage.getItem("kp-user");
  if (user || (nativeUser && hasLocalSession)) return children;

  return <Navigate to="/" replace />;
}