import React, { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import OrganizationTree from "../../components/OrganizationTree/OrganizationTree";
import UserForm from "../../components/UserForm/UserForm";
import { buildOrganizationTree, deleteUserByUID, fetchUsers, normalizeRole } from "../../services/organizationService";
import { auth } from "../../firebaseConfig";
import { useAuth } from "../../context/AuthContext";
import { BRAND_MAROON_PURPLE_GRADIENT } from "../../styles/brandTheme";

const ALLOWED = new Set(["admin", "sales_head", "director", "agm", "dgm", "hr_executive"]);
const SUBMODULES = [
  { key: "employees", label: "Employees" },
  { key: "organization_tree", label: "Organization Tree" },
  { key: "payslips", label: "Payslips" },
  { key: "salary_statement", label: "Salary Statement" },
];

const formatRole = (role) => {
  const raw = String(role || "").trim();
  if (!raw) return "-";
  return raw
    .replace(/[_-]+/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
};

const formatJoinDate = (v) => {
  const s = String(v || "").trim();
  if (!s) return "-";
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const [y, m, d] = s.split("-");
    return `${d}/${m}/${y}`;
  }
  return s;
};

const getEmployeeCode = (u) => {
  if (!u) return "";
  return String(u.employeeCode || u.empCode || u.empId || u.employeeId || "").trim();
};

const getEmployeeName = (u) => {
  if (!u) return "";
  return String(
    u.name ||
    u.Name ||
    u.fullName ||
    u.displayName ||
    u.employeeName ||
    u.employee_name ||
    ""
  ).trim();
};

export default function OrganizationPage() {
  const { user, roleData } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const isMobile = window.matchMedia("(max-width: 768px)").matches;

  const sessionUser = useMemo(() => {
    try {
      return JSON.parse(localStorage.getItem("kp-user") || "{}");
    } catch {
      return {};
    }
  }, []);

  const searchParams = new URLSearchParams(location.search || "");
  const selfMode = searchParams.get("self") === "1" || searchParams.get("mode") === "self";
  const backTarget = searchParams.get("from") === "login" ? "/apps" : "/apps";

  const myRole = normalizeRole(roleData?.role || user?.role || sessionUser?.role || "");
  const isAdmin = myRole === "admin";
  const effectiveUid = user?.uid || sessionUser?.uid || "";
  const canAccess = selfMode ? !!effectiveUid : ALLOWED.has(myRole);

  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeSubmodule, setActiveSubmodule] = useState("employees");
  const [employeeIdFilter, setEmployeeIdFilter] = useState("");
  const [employeeNameFilter, setEmployeeNameFilter] = useState("");
  const [employeesView, setEmployeesView] = useState("list");
  const [selectedEmployeeId, setSelectedEmployeeId] = useState("");
  const [selectedUIDForForm, setSelectedUIDForForm] = useState("");
  const [formResetNonce, setFormResetNonce] = useState(0);

  const reload = async () => {
    setLoading(true);
    try {
      const rows = await fetchUsers();
      setUsers(rows);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (selfMode) {
      // self mode only needs the current user record
      const uid = user?.uid || sessionUser?.uid || "";
      if (uid) {
        setSelectedEmployeeId(uid);
        setSelectedUIDForForm(uid);
        setEmployeesView("details");
      }
    }
    reload();
  }, [selfMode, user?.uid, sessionUser?.uid]);

  useEffect(() => {
    if (!selfMode) return;
    const ensureToken = async () => {
      try {
        if (sessionUser?.idToken) return;
        const token = await auth?.currentUser?.getIdToken?.(true);
        if (token) {
          const stored = JSON.parse(localStorage.getItem("kp-user") || "{}");
          stored.idToken = token;
          localStorage.setItem("kp-user", JSON.stringify(stored));
        }
      } catch (_) {}
    };
    ensureToken();
  }, [selfMode, sessionUser?.idToken]);

  const tree = useMemo(() => buildOrganizationTree(users), [users]);
  const filteredEmployees = useMemo(() => {
    const idNeedle = String(employeeIdFilter || "").trim().toLowerCase();
    const nameNeedle = String(employeeNameFilter || "").trim().toLowerCase();

    return users.filter((u) => {
      const idMatch = !idNeedle || getEmployeeCode(u).toLowerCase().includes(idNeedle);
      const nameMatch = !nameNeedle || getEmployeeName(u).toLowerCase().includes(nameNeedle);
      return idMatch && nameMatch;
    });
  }, [users, employeeIdFilter, employeeNameFilter]);

  const onExportEmployees = () => {
    const rows = filteredEmployees || [];
    if (!rows.length) return;

    const csvRows = [
      ["Joining Date", "EMP ID", "EMP Name", "Contact(ofc)", "Contact(pers)", "Role", "Status"],
      ...rows.map((r) => [
        formatJoinDate(r.joiningDate),
        getEmployeeCode(r) || "-",
        getEmployeeName(r),
        r.officePhone || r.phone || "",
        r.personalPhone || r.altPhone || r.phone || "",
        formatRole(r.role),
        r.isActive === false ? "Inactive" : "Active",
      ]),
    ];

    const csv = csvRows
      .map((row) => row.map((cell) => `"${String(cell ?? "").replace(/"/g, '""')}"`).join(","))
      .join("\n");

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `employees_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (!canAccess) {
    return (
      <div style={{ padding: 20 }}>
        <h2>Organization</h2>
        <p>You do not have access to this module.</p>
      </div>
    );
  }

  return (
    <div style={{ ...pageShell, ...(isMobile ? pageShellMobile : {}) }}>
      <div style={{ ...topBand, ...(isMobile ? topBandMobile : {}) }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button
            type="button"
            onClick={() => navigate("/apps")}
            style={{
              border: "1px solid rgba(255,255,255,0.65)",
              background: "transparent",
              color: "#fff",
              borderRadius: 10,
              padding: "6px 10px",
              fontWeight: 700,
              cursor: "pointer",
            }}
            aria-label="Back to apps"
          >
            ←
          </button>
          <h2 style={{ margin: 0, color: "#fff", fontSize: isMobile ? 30 : 42, fontWeight: 800, letterSpacing: 0.2 }}>
            Organization
          </h2>
        </div>
      </div>

      <div style={selfMode ? (isMobile ? contentWrapSelfMobile : contentWrapSelf) : (isMobile ? contentWrapMobile : contentWrap)}>
        {!selfMode && (
          <aside style={{ ...leftPanelCard, ...(isMobile ? leftPanelCardMobile : {}) }}>
            {SUBMODULES.map((m) => {
              const active = activeSubmodule === m.key;
              return (
                <button
                  key={m.key}
                  onClick={() => {
                    setActiveSubmodule(m.key);
                    if (m.key === "employees" && employeesView === "details" && !selectedEmployeeId) {
                      setEmployeesView("list");
                    }
                  }}
                  style={{
                    ...leftItemBtn,
                    ...(isMobile ? leftItemBtnMobile : {}),
                    ...(active ? leftItemBtnActive : {}),
                    ...(isMobile && active ? leftItemBtnActiveMobile : {}),
                  }}
                >
                  {m.label}
                </button>
              );
            })}
          </aside>
        )}

        <main style={{ ...rightPane, ...(isMobile ? rightPaneMobile : {}) }}>
          {loading && (
            <div style={{ marginBottom: 10, color: "#6b7280", fontWeight: 600 }}>Loading organization data...</div>
          )}

          {(selfMode || activeSubmodule === "employees") && (
            <div style={{ ...panelCard, ...(isMobile ? panelCardMobile : {}) }}>
              {employeesView === "list" && !selfMode && (
                <>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                      <h3 style={{ margin: 0 }}>Employees</h3>
                      <input
                        style={{ ...searchInput, ...(isMobile ? searchInputMobile : {}) }}
                        placeholder="Search by ID"
                        value={employeeIdFilter}
                        onChange={(e) => setEmployeeIdFilter(e.target.value.toUpperCase())}
                      />
                      <input
                        style={{ ...searchInput, ...(isMobile ? searchInputMobile : {}) }}
                        placeholder="Search by name"
                        value={employeeNameFilter}
                        onChange={(e) => setEmployeeNameFilter(e.target.value)}
                      />
                    </div>

                    <div style={{ display: "flex", gap: 8 }}>
                      <button
                        style={{ ...btnPrimary, ...(isMobile ? btnPrimaryMobile : {}) }}
                        onClick={() => {
                          setSelectedEmployeeId("");
                          setSelectedUIDForForm("");
                          setFormResetNonce((n) => n + 1);
                          setEmployeesView("create");
                        }}
                      >
                        Add Employee
                      </button>
                      <button style={{ ...btnPrimary, ...(isMobile ? btnPrimaryMobile : {}) }} onClick={onExportEmployees}>Export</button>
                    </div>
                  </div>

                  <div style={{ ...tableWrapFull, ...(isMobile ? tableWrapFullMobile : {}) }}>
                    <table style={{ ...tableStyle, ...(isMobile ? tableStyleMobile : {}) }}>
                      <thead>
                        <tr>
                          <th style={thHeaderDark}>Joining Date</th>
                          <th style={thHeaderDark}>EMP ID</th>
                          <th style={thHeaderDark}>EMP Name</th>
                          <th style={thHeaderDark}>Contact(ofc)</th>
                          <th style={thHeaderDark}>Contact(pers)</th>
                          <th style={thHeaderDark}>Role</th>
                          <th style={thHeaderDark}>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredEmployees.map((row) => (
                          <tr
                            key={row.id}
                            style={row.id === selectedEmployeeId ? activeRow : undefined}
                            onClick={() => {
                              setSelectedEmployeeId(row.id);
                              setSelectedUIDForForm(row.id);
                              setEmployeesView("details");
                            }}
                          >
                            <td style={td}>{formatJoinDate(row.joiningDate)}</td>
                            <td style={td}>{getEmployeeCode(row) || "-"}</td>
                            <td style={td}>{getEmployeeName(row) || "-"}</td>
                            <td style={td}>{row.officePhone || row.phone || "-"}</td>
                            <td style={td}>{row.personalPhone || row.altPhone || row.phone || "-"}</td>
                            <td style={td}>{formatRole(row.role)}</td>
                            <td style={{ ...td, cursor: "default" }}>
                              <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                                <span>{row.isActive === false ? "Inactive" : "Active"}</span>
                                {isAdmin && (
                                  <button
                                    type="button"
                                    style={btnDangerInline}
                                    onClick={async (e) => {
                                      e.stopPropagation();
                                      const uid = String(row?.id || "").trim();
                                      const name = getEmployeeName(row) || uid;
                                      if (!uid) return;
                                      if (uid === user?.uid) {
                                        alert("You cannot delete your own account.");
                                        return;
                                      }
                                      if (!window.confirm(`Delete employee ${name}? This action cannot be undone.`)) return;

                                      try {
                                        await deleteUserByUID(uid);
                                        if (selectedEmployeeId === uid) {
                                          setSelectedEmployeeId("");
                                          setSelectedUIDForForm("");
                                        }
                                        await reload();
                                      } catch (err) {
                                        alert(err?.message || "Failed to delete employee");
                                      }
                                    }}
                                  >
                                    Delete
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                        ))}
                        {!filteredEmployees.length && (
                          <tr>
                            <td style={tdEmpty} colSpan={7}>No employees found for this filter.</td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>

                  <div style={tableCountText}>Employee Count: {filteredEmployees.length}</div>
                </>
              )}

              {employeesView === "details" && (
                <>
                  <div style={employeePageHeader}>
                    <h3 style={{ margin: 0 }}>{selfMode ? "My Profile" : "Edit Employee"}</h3>
                    <button
                      style={{ ...btnSecondary, ...(isMobile ? btnSecondaryMobile : {}) }}
                      onClick={() => {
                        if (selfMode) {
                          navigate(backTarget);
                          return;
                        }
                        setEmployeesView("list");
                      }}
                    >
                      {selfMode ? "Back to Apps" : "Back to Employees"}
                    </button>
                  </div>

                  <UserForm
                    key={`${selectedUIDForForm || "new"}-${formResetNonce}`}
                    users={selfMode ? [] : users}
                    selectedUID={selectedUIDForForm}
                    actorEmail={user?.email || sessionUser?.email || ""}
                    selfMode={selfMode}
                    actorRole={myRole}
                    onSaved={async (uid) => {
                      setSelectedEmployeeId(uid);
                      setSelectedUIDForForm(uid);
                      await reload();
                      setEmployeesView("details");
                    }}
                  />
                </>
              )}

              {employeesView === "create" && !selfMode && (
                <>
                  <div style={employeePageHeader}>
                    <h3 style={{ margin: 0 }}>Add Employee</h3>
                    <button style={{ ...btnSecondary, ...(isMobile ? btnSecondaryMobile : {}) }} onClick={() => setEmployeesView("list")}>Back to Employees</button>
                  </div>

                  <UserForm
                    key={`${selectedUIDForForm || "new"}-${formResetNonce}`}
                    users={users}
                    selectedUID=""
                    actorEmail={user?.email || ""}
                    actorRole={myRole}
                    onSaved={async (uid) => {
                      setSelectedEmployeeId(uid);
                      setSelectedUIDForForm(uid);
                      await reload();
                      setEmployeesView("details");
                    }}
                  />
                </>
              )}
            </div>
          )}

          {activeSubmodule === "organization_tree" && (
            <div style={{ ...panelCard, ...(isMobile ? panelCardMobile : {}) }}>
              <OrganizationTree
                treeData={tree}
                onSelectNode={(node) => {
                  setSelectedUIDForForm(node?.id || "");
                }}
              />
            </div>
          )}

          {activeSubmodule === "payslips" && (
            <div style={{ ...submoduleWhiteShell, ...(isMobile ? submoduleWhiteShellMobile : {}) }}>
              <h3 style={{ marginTop: 0 }}>Payslips</h3>
              <p style={{ marginBottom: 0, color: "#6b7280" }}>
                Payslip submodule shell is ready. We can now connect month-wise payslip upload, employee payslip history, and download actions.
              </p>
            </div>
          )}

          {activeSubmodule === "salary_statement" && (
            <div style={{ ...submoduleWhiteShell, ...(isMobile ? submoduleWhiteShellMobile : {}) }}>
              <h3 style={{ marginTop: 0 }}>Salary Statement</h3>
              <p style={{ marginBottom: 0, color: "#6b7280" }}>
                Salary statement submodule shell is ready. Next, we can wire monthly statements, totals, and export.
              </p>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

const pageShell = {
  minHeight: "100vh",
  background: BRAND_MAROON_PURPLE_GRADIENT,
  width: "100%",
  overflowX: "hidden",
};

const pageShellMobile = {
  paddingBottom: "12px",
};

const topBand = {
  padding: "24px 22px",
  boxSizing: "border-box",
  background: BRAND_MAROON_PURPLE_GRADIENT,
  borderBottom: "1px solid rgba(255,255,255,0.15)",
  boxShadow: "0 8px 16px rgba(0,0,0,0.2)",
};

const topBandMobile = {
  padding: "calc(env(safe-area-inset-top, 0px) + 10px) 16px 14px",
};

const contentWrap = {
  display: "grid",
  gridTemplateColumns: "260px minmax(0, 1fr)",
  gap: 14,
  minHeight: "calc(100vh - 98px)",
  width: "100%",
  boxSizing: "border-box",
};

const contentWrapMobile = {
  display: "grid",
  gridTemplateColumns: "1fr",
  gap: 12,
  minHeight: "auto",
  padding: "6px 12px 0",
};

const contentWrapSelf = {
  display: "block",
  minHeight: "calc(100vh - 98px)",
  width: "100%",
  boxSizing: "border-box",
};

const contentWrapSelfMobile = {
  display: "block",
  minHeight: "auto",
  padding: "6px 12px 0",
};

const rightPane = {
  background: "#ffffff",
  padding: 12,
  marginRight: 0,
  borderLeft: "none",
  minWidth: 0,
  maxWidth: "100%",
  overflow: "hidden",
  minHeight: "calc(100vh - 98px)",
};

const rightPaneMobile = {
  borderRadius: 16,
  padding: 12,
  minHeight: "auto",
  boxShadow: "0 10px 24px rgba(0,0,0,0.12)",
  marginBottom: 16,
};

const btnPrimary = {
  border: "1px solid rgba(128,0,0,0.45)",
  background: BRAND_MAROON_PURPLE_GRADIENT,
  color: "#fff",
  borderRadius: 0,
  padding: "8px 18px",
  cursor: "pointer",
  fontWeight: 800,
  fontSize: 14,
};

const btnPrimaryMobile = {
  borderRadius: 10,
  padding: "8px 12px",
  fontSize: 12,
};

const btnSecondary = {
  border: "1px solid #c9cdd5",
  background: "#fff",
  color: "#111827",
  borderRadius: 0,
  padding: "8px 16px",
  cursor: "pointer",
  fontWeight: 700,
  fontSize: 14,
};

const btnSecondaryMobile = {
  borderRadius: 10,
  padding: "8px 12px",
  fontSize: 12,
};

const panelCard = {
  background: "#ffffff",
  border: "none",
  borderRadius: 0,
  padding: 0,
  maxWidth: "100%",
};

const panelCardMobile = {
  padding: 6,
};

const submoduleWhiteShell = {
  background: "#ffffff",
  border: "1px solid #f0f0f0",
  borderRadius: 0,
  padding: 12,
  minHeight: "calc(100vh - 170px)",
};

const submoduleWhiteShellMobile = {
  borderRadius: 14,
  minHeight: "auto",
  boxShadow: "0 8px 18px rgba(0,0,0,0.08)",
};

const leftPanelCard = {
  background: "transparent",
  border: "none",
  position: "sticky",
  top: 12,
  alignSelf: "start",
  height: "fit-content",
  display: "flex",
  flexDirection: "column",
  gap: 8,
  padding: "46px 12px 0 12px",
};

const leftPanelCardMobile = {
  position: "relative",
  top: 0,
  flexDirection: "row",
  gap: 10,
  padding: "4px 0 2px",
  overflowX: "auto",
  WebkitOverflowScrolling: "touch",
};

const leftItemBtn = {
  border: "none",
  background: "transparent",
  color: "#fff",
  borderRadius: 10,
  padding: "8px 12px",
  textAlign: "left",
  fontWeight: 700,
  fontSize: 15,
  cursor: "pointer",
};

const leftItemBtnMobile = {
  borderRadius: 12,
  padding: "8px 14px",
  fontSize: 13,
  whiteSpace: "nowrap",
  background: "rgba(255,255,255,0.08)",
};

const leftItemBtnActive = {
  border: "1px solid rgba(255,255,255,0.45)",
  background: BRAND_MAROON_PURPLE_GRADIENT,
  color: "#fff",
};

const leftItemBtnActiveMobile = {
  boxShadow: "0 6px 14px rgba(0,0,0,0.18)",
};

const searchInput = {
  border: "1px solid #bdd5e2",
  borderRadius: 0,
  padding: "8px 10px",
  minWidth: 130,
  background: "#d7e8f1",
  fontSize: 14,
};

const searchInputMobile = {
  borderRadius: 10,
  minWidth: 120,
  fontSize: 12,
  padding: "7px 10px",
};

const tableWrap = {
  border: "none",
  borderRadius: 0,
  overflow: "auto",
  maxHeight: "72vh",
  background: "#fff",
};

const tableWrapFull = {
  ...tableWrap,
  maxHeight: "75vh",
};

const tableWrapFullMobile = {
  maxHeight: "none",
  overflowX: "auto",
  borderRadius: 12,
  border: "1px solid #f1f1f1",
};

const tableStyle = {
  width: "100%",
  borderCollapse: "collapse",
};

const tableStyleMobile = {
  minWidth: 700,
};

const th = {
  textAlign: "left",
  padding: "10px 10px",
  background: "#f8fafc",
  borderBottom: "1px solid #e5e7eb",
  fontSize: 13,
  color: "#111827",
  position: "sticky",
  top: 0,
  zIndex: 1,
  fontWeight: 700,
};

const thHeaderDark = {
  ...th,
  background: BRAND_MAROON_PURPLE_GRADIENT,
  color: "#fff",
};

const td = {
  padding: "10px 10px",
  borderBottom: "1px solid #cfd5de",
  fontSize: 13,
  color: "#1f2937",
  cursor: "pointer",
};

const tdEmpty = {
  ...td,
  cursor: "default",
  color: "#6b7280",
  textAlign: "center",
};

const activeRow = {
  background: "#fff",
  boxShadow: "inset 0 0 0 9999px rgba(128,0,0,0.06)",
};

const tableCountText = {
  marginTop: 8,
  fontSize: 13,
  color: "#374151",
  fontWeight: 600,
};

const btnDangerInline = {
  border: "1px solid #b91c1c",
  background: "#ef4444",
  color: "#fff",
  borderRadius: 8,
  padding: "6px 10px",
  cursor: "pointer",
  fontSize: 12,
  fontWeight: 700,
};

const employeePageHeader = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 10,
  marginBottom: 12,
};
