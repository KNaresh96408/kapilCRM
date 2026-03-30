import React, { useEffect } from "react";

export default function ResetPassword() {
  useEffect(() => {
    const url = new URL(window.location.href);
    const email = String(url.searchParams.get("email") || "").trim();
    const next = email ? `/forgot-password?email=${encodeURIComponent(email)}` : "/forgot-password";
    window.location.replace(next);
  }, []);

  return null;
}
