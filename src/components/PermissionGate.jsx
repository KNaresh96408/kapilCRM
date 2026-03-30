import React from "react";
import { useAuth } from "../context/AuthContext";
import { usePermission } from "../hooks/usePermission";

export default function PermissionGate({ moduleName = "", children }) {
  const { user } = useAuth();
  const perm = usePermission(moduleName);

  const normalizeRole = (raw) => {
    const base = (raw || "").toString().trim().toLowerCase();
    if (!base) return "";
    const underscored = base.replace(/[\s-]+/g, "_").replace(/_+/g, "_");
    const compact = underscored.replace(/_/g, "");
    const aliasByCompact = {
      saleshead: "sales_head",
      hroperationsmanager: "agm",
      hr_operations_manager: "agm",
      agm: "agm",
      financemanager: "dgm",
      finance_manager: "dgm",
      dgm: "dgm",
      salesheadmanager: "sales_head",
    };
    return aliasByCompact[compact] || underscored;
  };

  // safety
  if (!moduleName) return null;

  const role = normalizeRole(user?.role || user?.Role || user?.designation || "");
  const isServiceEngineer = role === "service_engineer" || role === "service_enginner";
  const belongsTo = String(
    user?.belongsTo || user?.belongs_to || user?.team || user?.profile?.belongsTo || ""
  )
    .trim()
    .toLowerCase();

  const isOperationsTeam =
    (role === "operations_manager" ||
      role === "operations_executive" ||
      belongsTo.includes("operations")) &&
    !belongsTo.includes("rooftop");

  // 🚫 Attachments should be available to everyone EXCEPT operations team
  if (moduleName === "attachments" && isOperationsTeam) {
    return (
      <div style={{ padding: 40, textAlign: "center", color: "#800000" }}>
        ❌ Attachments module is not available for Operations team.
      </div>
    );
  }

  // ✅ Attachments should open for all non-operations users
  // even when modulePermissions entry is missing.
  if (moduleName === "attachments") {
    if (isServiceEngineer) {
      return (
        <div style={{ padding: 40, textAlign: "center", color: "#800000" }}>
          ❌ This module is not available for Service Engineer role.
        </div>
      );
    }
    return <>{children}</>;
  }

  if (isServiceEngineer) {
    return (
      <div style={{ padding: 40, textAlign: "center", color: "#800000" }}>
        ❌ This module is not available for Service Engineer role.
      </div>
    );
  }

  // 🔥 SUPER ROLES = ALWAYS ALLOWED (NO ASYNC, NO STATE)
  const SUPER_ROLES = [
    "admin",
    "sales_head",
    "director",
    "dgm",
    "agm",
  ];

  if (SUPER_ROLES.includes(role)) {
    return <>{children}</>;
  }

  // ⏳ wait while module permission is loading
  if (perm.loading) {
    return null;
  }

  if (perm.read) {
    return <>{children}</>;
  }

  // ❌ denied
  return (
    <div style={{ padding: 40, textAlign: "center", color: "#800000" }}>
      ❌ You don’t have permission to view this module.
    </div>
  );
}