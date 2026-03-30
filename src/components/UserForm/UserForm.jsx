import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ROLE_HIERARCHY,
  deleteEmployeeProfilePhoto,
  deleteEmployeeAttachment,
  fetchAreasByZone,
  fetchUserByUID,
  fetchZonesByState,
  getManagerCandidates,
  normalizeRole,
  uploadEmployeeAttachment,
  uploadEmployeeProfilePhoto,
  upsertUserByUID,
} from "../../services/organizationService";
import { auth } from "../../firebaseConfig";
import { getStateOptions, getZoneOptions, getAreaOptions } from "../../helpers/salesRegions";

const STATES = getStateOptions();
const DEFAULT_PERMISSIONS = ["Create", "Read", "Update"];
const ADMIN_PERMISSIONS = ["Create", "Read", "Update", "Delete"];
const stripDelete = (perms = []) => perms.filter((p) => String(p).toLowerCase() !== "delete");
const BELONGS_TO_OPTIONS = [
  { value: "rooftop", label: "Kapil Power Rooftop Team" },
  { value: "operations", label: "Kapil Power Operations Team" },
];

const EMPLOYEE_MANAGE_ROLES = new Set([
  "admin",
  "sales_head",
  "director",
  "dgm",
  "agm",
  "hr_executive",
]);

const EMPTY_FORM = {
  employeeCode: "",
  name: "",
  dob: "",
  address: "",
  belongsTo: "",
  email: "",
  crmId: "",
  password: "",
  role: "",
  designation: "",
  state: "",
  sales_zone: "",
  sales_area: "",
  managerUID: "",
  reportsTo: "",
  hierarchyLevel: 7,
  officePhone: "",
  personalPhone: "",
  emergencyContact: "",
  phone: "",
  uan: "",
  employeeType: "",
  bloodGroup: "",
  packageAmount: "",
  joiningDate: "",
  permissions: DEFAULT_PERMISSIONS,
  isActive: true,
  attachments: [],
  profilePhotoUrl: "",
  profilePhotoPath: "",
  profilePhotoPreview: "",
};

const ROLE_OPTIONS = [
  { value: "director", label: "director" },
  { value: "sales_head", label: "sales_head" },
  { value: "dgm", label: "DGM" },
  { value: "agm", label: "AGM" },
  { value: "hr_executive", label: "hr_executive" },
  { value: "state_head", label: "state_head" },
  { value: "zonal_manager", label: "zonal_manager" },
  { value: "area_sales_manager", label: "area_sales_manager" },
  { value: "team_lead", label: "team_lead" },
  { value: "consultant", label: "consultant" },
  { value: "tele-caller", label: "tele-caller" },
  { value: "accountant", label: "accountant" },
  { value: "operations_manager", label: "operations_manager" },
  { value: "operations_executive", label: "operations_executive" },
  { value: "designer", label: "designer" },
  { value: "other", label: "other" },
];

const getLevelLabel = (level) => {
  const n = Number(level || 0);
  if (!n || Number.isNaN(n)) return "Level -";
  const alpha = String.fromCharCode(64 + Math.min(Math.max(n, 1), 26));
  return `Level ${alpha} (${n})`;
};

const getUserName = (u) => (u?.name || u?.Name || u?.fullName || u?.displayName || "");
const getUserEmail = (u) => (u?.email || "");

const formatManagerOptionLabel = (u) => {
  if (!u) return "";
  const n = getUserName(u);
  const e = getUserEmail(u);
  if (n && e) return `${n} (${e})`;
  return n || e || u.id;
};

const buildFormSnapshot = (uid, form) => JSON.stringify({
  uid: String(uid || "").trim(),
  employeeCode: form.employeeCode || "",
  name: form.name || "",
  dob: form.dob || "",
  address: form.address || "",
  belongsTo: form.belongsTo || "",
  email: form.email || "",
  crmId: form.crmId || "",
  password: form.password || "",
  role: form.role || "",
  designation: form.designation || "",
  state: form.state || "",
  sales_zone: form.sales_zone || "",
  sales_area: form.sales_area || "",
  managerUID: form.managerUID || "",
  reportsTo: form.reportsTo || "",
  hierarchyLevel: Number(form.hierarchyLevel || 0),
  officePhone: form.officePhone || "",
  personalPhone: form.personalPhone || "",
  emergencyContact: form.emergencyContact || "",
  uan: form.uan || "",
  employeeType: form.employeeType || "",
  joiningDate: form.joiningDate || "",
  permissions: Array.isArray(form.permissions) && form.permissions.length ? form.permissions : DEFAULT_PERMISSIONS,
  bloodGroup: form.bloodGroup || "",
  packageAmount: form.packageAmount || "",
  isActive: form.isActive !== false,
  profilePhotoUrl: form.profilePhotoUrl || "",
});

const normalizeBelongsToValue = (value) => {
  const v = String(value || "").trim().toLowerCase();
  if (!v) return "";
  if (v.includes("operations")) return "operations";
  if (v.includes("rooftop")) return "rooftop";
  return v;
};

const normalizeEmployeeType = (value) => {
  const v = String(value || "").trim().toLowerCase();
  if (!v) return "";
  if (v.includes("remote")) return "Remote";
  if (v.includes("off") || v.includes("field")) return "Off-site";
  if (v.includes("on") || v.includes("office")) return "Onsite";
  return value;
};

function LabeledField({ label, children }) {
  return (
    <div style={styles.labeledField}>
      <div style={styles.fieldCaption}>{label}</div>
      <div style={styles.fieldBody}>{children}</div>
    </div>
  );
}

export default function UserForm({ users = [], selectedUID = "", actorEmail = "", onSaved, selfMode = false, actorRole = "" }) {
  const [uidInput, setUidInput] = useState("");
  const [isExisting, setIsExisting] = useState(false);
  const [loadingUser, setLoadingUser] = useState(false);
  const [saving, setSaving] = useState(false);

  const [zones, setZones] = useState([]);
  const [areas, setAreas] = useState([]);

  const [uploading, setUploading] = useState(false);
  const [uploadingProfile, setUploadingProfile] = useState(false);
  const [attachmentType, setAttachmentType] = useState("Document");
  const [form, setForm] = useState(EMPTY_FORM);
  const [showPassword, setShowPassword] = useState(false);
  const [customRole, setCustomRole] = useState("");
  const [reportsToInput, setReportsToInput] = useState("");
  const [showReportsList, setShowReportsList] = useState(false);
  const [initialSnapshot, setInitialSnapshot] = useState(buildFormSnapshot("", EMPTY_FORM));
  const [lastLoadedUid, setLastLoadedUid] = useState("");

  useEffect(() => {
    const state = form.state;
    const roleKey = normalizeRole(form.role);
    if (!state) {
      if (roleKey === "telecaller") {
        const allZones = Array.from(
          new Set(
            STATES.flatMap((s) => getZoneOptions(s))
          )
        ).map((name) => ({ id: name, name }));
        setZones(allZones);
        return;
      }
      setZones([]);
      return;
    }
    fetchZonesByState(state).then(setZones).catch(() => setZones([]));
  }, [form.state, form.role]);

  useEffect(() => {
    const state = form.state;
    const zone = form.sales_zone;
    if (!state || !zone) {
      setAreas([]);
      return;
    }
    fetchAreasByZone(state, zone).then(setAreas).catch(() => setAreas([]));
  }, [form.state, form.sales_zone]);

  useEffect(() => {
    if (!form.state) return;
    const available = zones.map((z) => z.name);
    if (form.sales_zone && available.length && !available.includes(form.sales_zone)) {
      setForm((prev) => ({ ...prev, sales_zone: "", sales_area: "", managerUID: "", reportsTo: "" }));
    }
  }, [zones, form.state, form.sales_zone]);

  useEffect(() => {
    if (!form.state || !form.sales_zone) return;
    const available = areas.map((a) => a.name);
    if (form.sales_area && available.length && !available.includes(form.sales_area)) {
      setForm((prev) => ({ ...prev, sales_area: "", managerUID: "", reportsTo: "" }));
    }
  }, [areas, form.state, form.sales_zone, form.sales_area]);

  const managerOptions = useMemo(
    () => getManagerCandidates(users, form.role, form.state, form.sales_zone, form.sales_area),
    [users, form.role, form.state, form.sales_zone, form.sales_area]
  );

  const loadByUID = useCallback(async (rawUid) => {
    const clean = String(rawUid || "").trim();
    if (!clean) return;
    setLoadingUser(true);
    try {
      const row = await fetchUserByUID(clean);
      if (!row) {
        setIsExisting(false);
        setForm({ ...EMPTY_FORM });
        setInitialSnapshot(buildFormSnapshot(clean, EMPTY_FORM));
        setReportsToInput("");
        return;
      }

      setIsExisting(true);
      const isRowAdmin = normalizeRole(row.role || row.Role || "") === "admin";
      const nextForm = {
        employeeCode: row.employeeCode || row.empCode || row.empId || row.employeeId || "",
        name: row.name || row.Name || row.fullName || row.displayName || "",
        dob: row.dob || row.dateOfBirth || row.birthDate || "",
        address: row.address || row.Address || row.currentAddress || "",
        belongsTo: normalizeBelongsToValue(row.belongsTo || row.belongs_to || row.team || ""),
        email: row.email || "",
        crmId: row.crmId || row.crmID || row.crmEmail || row.crmMailId || "",
        password: row.password || "",
        role: normalizeRole(row.role || row.Role || ""),
        designation: row.designation || "",
        state: row.state || "",
        sales_zone: row.sales_zone || "",
        sales_area: row.sales_area || "",
        managerUID: row.managerUID || "",
        reportsTo: row.reportsTo || row.managerUID || "",
        hierarchyLevel: Number(row.hierarchyLevel || 7),
        officePhone: row.officePhone || row.phone || "",
        personalPhone: row.personalPhone || row.altPhone || "",
        emergencyContact: row.emergencyContact || row.emergencyPhone || "",
        phone: row.phone || row.officePhone || "",
        uan: row.uan || row.UAN || "",
        employeeType: normalizeEmployeeType(row.employeeType || row.employmentType || ""),
        bloodGroup: row.bloodGroup || row.blood_group || row.bloodGroupType || "",
        packageAmount: row.packageAmount || row.package || row.salaryPackage || "",
        joiningDate: row.joiningDate || "",
        permissions: isRowAdmin
          ? ADMIN_PERMISSIONS
          : (Array.isArray(row.permissions) && row.permissions.length
            ? stripDelete(row.permissions)
            : DEFAULT_PERMISSIONS),
        isActive: row.isActive !== false,
        attachments: Array.isArray(row.attachments) ? row.attachments : [],
        profilePhotoUrl: row.profilePhotoUrl || row.profilePhoto || row.photoURL || "",
        profilePhotoPath: row.profilePhotoPath || "",
        profilePhotoPreview: row.profilePhotoPreview || "",
      };
      setForm(nextForm);
      setInitialSnapshot(buildFormSnapshot(clean, nextForm));

      const selectedManagerUid = row.managerUID || row.reportsTo || "";
      const managerUser = (users || []).find((u) => u.id === selectedManagerUid);
      setReportsToInput(managerUser ? formatManagerOptionLabel(managerUser) : selectedManagerUid);

      const knownRoles = new Set(ROLE_OPTIONS.map((r) => r.value));
      const roleValue = normalizeRole(String(row.role || row.Role || ""));
      if (roleValue && !knownRoles.has(roleValue)) {
        setCustomRole(roleValue);
      } else {
        setCustomRole("");
      }
    } finally {
      setLoadingUser(false);
    }
  }, [users]);

  useEffect(() => {
    if (selectedUID) {
      setUidInput(selectedUID);
      loadByUID(selectedUID);
      setLastLoadedUid(selectedUID);
      return;
    }

    setUidInput("");
    setIsExisting(false);
    setForm({ ...EMPTY_FORM });
    setLastLoadedUid("");
  }, [selectedUID, loadByUID]);

  useEffect(() => {
    const clean = String(uidInput || "").trim();
    if (!clean) return;
    if (clean === lastLoadedUid) return;

    const t = window.setTimeout(async () => {
      await loadByUID(clean);
      setLastLoadedUid(clean);
    }, 400);

    return () => window.clearTimeout(t);
  }, [uidInput, lastLoadedUid, loadByUID]);

  const roleOptions = useMemo(() => {
    const base = ROLE_OPTIONS.filter((r) => r.value !== "other");
    const blockedLegacy = new Set(["finance_manager", "hr_operations_manager"]);
    const userRoles = Array.from(new Set((users || [])
      .map((u) => normalizeRole(u.role || u.Role || ""))
      .filter(Boolean)
      .filter((r) => !blockedLegacy.has(r))));

    userRoles.forEach((r) => {
      if (!base.some((b) => b.value === r)) base.push({ value: r, label: r });
    });

    base.push({ value: "other", label: "other" });
    return base;
  }, [users]);

  const onRoleChange = (role) => {
    if (role === "other") {
      setCustomRole("");
      setForm((prev) => ({ ...prev, role: "", hierarchyLevel: 7, managerUID: "", reportsTo: "" }));
      return;
    }

    const roleKey = normalizeRole(role);
    const level = ROLE_HIERARCHY[roleKey] || 7;

    setForm((prev) => {
      const next = { ...prev, role, hierarchyLevel: level, managerUID: "", reportsTo: "" };

      if (!(roleKey === "team_lead" || roleKey === "state_head" || roleKey === "telecaller")) {
        next.state = "";
      }
      if (!(roleKey === "consultant" || roleKey === "area_sales_manager" || roleKey === "zonal_manager" || roleKey === "telecaller")) {
        next.sales_zone = "";
      }
      if (!(roleKey === "consultant" || roleKey === "area_sales_manager")) {
        next.sales_area = "";
      }

      return next;
    });
  };

  const onSave = async () => {
    if (!isSelfMode && !canManageEmployees) {
      alert("You do not have permission to update employees.");
      return;
    }
    try {
      const token = await auth?.currentUser?.getIdToken?.(true);
      if (token) {
        const stored = JSON.parse(localStorage.getItem("kp-user") || "{}");
        stored.idToken = token;
        localStorage.setItem("kp-user", JSON.stringify(stored));
      }
    } catch {
      // ignore token refresh errors
    }
    const uid = String(uidInput || "").trim();
    if (!uid) return alert("Firestore UID is required");
    if (!form.name || !form.role) return alert("Please fill name and role");

    setSaving(true);
    try {
      const actorRoleKey = normalizeRole(actorRole);
      const actorIsAdmin = actorRoleKey === "admin";

      const payloadBase = normalizeRole(form.role) === "admin"
        ? { ...form, isActive: true }
        : { ...form };

      if (!actorIsAdmin) {
        delete payloadBase.permissions;
      }

      const payload = payloadBase;
      await upsertUserByUID(uid, payload, actorEmail);
      alert(isSelfMode ? "User updated" : (isExisting ? "User updated" : "User created"));
      setIsExisting(true);
      setInitialSnapshot(buildFormSnapshot(uid, payload));
      if (onSaved) onSaved(uid);
    } catch (e) {
      alert(e?.message || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const onUploadAttachment = async (file) => {
    const uid = String(uidInput || "").trim();
    if (!uid) return alert("Enter UID first");
    if (!file) return;
    setUploading(true);
    try {
      const added = await uploadEmployeeAttachment(uid, file, attachmentType);
      setForm((prev) => ({ ...prev, attachments: [...(prev.attachments || []), added] }));
    } catch (e) {
      alert(e?.message || "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const onUploadProfilePhoto = async (file) => {
    const uid = String(uidInput || "").trim();
    if (!uid) return alert("Enter UID first");
    if (!file) return;
    setUploadingProfile(true);

    // instant preview
    try {
      const preview = await new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => resolve("");
        reader.readAsDataURL(file);
      });
      if (preview) {
        setForm((prev) => ({ ...prev, profilePhotoPreview: preview }));
        if (isSelfMode) {
          try {
            const stored = localStorage.getItem("kp-user");
            const parsed = stored ? JSON.parse(stored) : null;
            if (parsed && parsed.uid === uid) {
              const next = { ...parsed, profilePhotoPreview: preview };
              localStorage.setItem("kp-user", JSON.stringify(next));
              window.dispatchEvent(new CustomEvent("kp-login", { detail: next }));
            }
          } catch (e) {
            console.warn("Failed to cache profile preview", e);
          }
        }
      }
    } catch (e) {
      console.warn("Preview generation failed", e);
    }

    try {
      const updated = await uploadEmployeeProfilePhoto(uid, file);
      setForm((prev) => ({
        ...prev,
        profilePhotoUrl: updated.url,
        profilePhotoPath: updated.storagePath,
      }));

      if (isSelfMode) {
        try {
          const stored = localStorage.getItem("kp-user");
          const parsed = stored ? JSON.parse(stored) : null;
          if (parsed && parsed.uid === uid) {
            const next = {
              ...parsed,
              profilePhotoUrl: updated.url,
              profilePhotoPath: updated.storagePath,
            };
            localStorage.setItem("kp-user", JSON.stringify(next));
            window.dispatchEvent(new CustomEvent("kp-login", { detail: next }));
          }
        } catch (e) {
          console.warn("Failed to update local profile photo cache", e);
        }
      }
    } catch (e) {
      alert(e?.message || "Profile photo upload failed");
    } finally {
      setUploadingProfile(false);
    }
  };

  const onDeleteAttachment = async (attachmentId) => {
    const uid = String(uidInput || "").trim();
    if (!uid) return;
    try {
      await deleteEmployeeAttachment(uid, attachmentId);
      setForm((prev) => ({
        ...prev,
        attachments: (prev.attachments || []).filter((a) => a.id !== attachmentId),
      }));
    } catch (e) {
      alert(e?.message || "Delete failed");
    }
  };

  const roleKey = normalizeRole(form.role);
  const needsState = roleKey === "state_head" || roleKey === "team_lead" || roleKey === "telecaller" || roleKey === "consultant" || roleKey === "area_sales_manager" || roleKey === "zonal_manager" || roleKey === "service_engineer";
  const needsZone = roleKey === "consultant" || roleKey === "area_sales_manager" || roleKey === "zonal_manager" || roleKey === "telecaller" || roleKey === "service_engineer";
  const needsArea = roleKey === "consultant" || roleKey === "area_sales_manager";
  const isAdminRole = roleKey === "admin";
  const isSelfMode = !!selfMode;
  const canManageEmployees = EMPLOYEE_MANAGE_ROLES.has(normalizeRole(actorRole));
  const canManageDocs = isSelfMode || canManageEmployees;
  const canEditField = (fieldKey) => {
    if (isSelfMode) return fieldKey === "dob" || fieldKey === "bloodGroup";
    return canManageEmployees;
  };
  const isFieldReadOnly = (fieldKey) => !canEditField(fieldKey);

  useEffect(() => {
    if (isAdminRole && form.isActive === false) {
      setForm((prev) => ({ ...prev, isActive: true }));
    }
  }, [isAdminRole, form.isActive]);

  const candidatePool = users || [];
  const filteredManagerOptions = candidatePool
    .filter((u) => {
      const needle = String(reportsToInput || "").trim().toLowerCase();
      if (!needle) return true;
      const hay = `${u.name || ""} ${u.email || ""} ${u.id || ""}`.toLowerCase();
      return hay.includes(needle);
    })
    .slice(0, 25);

  const currentSnapshot = useMemo(() => buildFormSnapshot(uidInput, form), [uidInput, form]);
  const hasChanges = !isExisting || currentSnapshot !== initialSnapshot;
  const normalizedPermissions = isAdminRole
    ? ADMIN_PERMISSIONS
    : (Array.isArray(form.permissions) && form.permissions.length
      ? stripDelete(form.permissions)
      : DEFAULT_PERMISSIONS);
  const canSave = isSelfMode || canManageEmployees;

  return (
    <div style={styles.wrapper}>
      <div style={styles.card}>
        <h3 style={styles.sectionTitle}>User Management</h3>
        {loadingUser && <div style={styles.noChangesText}>Loading employee data...</div>}

        <div style={styles.gridHeader}>
        <LabeledField label="UID">
          <input
            value={uidInput}
            onChange={(e) => setUidInput(e.target.value.trim())}
            placeholder="Firestore UID"
            style={styles.input}
            readOnly={isSelfMode || !canManageEmployees}
          />
        </LabeledField>
        <LabeledField label="Mode">
          <div style={styles.modeText}>{isSelfMode ? "Edit Mode" : (isExisting ? "Edit Mode" : "Create Mode")}</div>
        </LabeledField>
        </div>

        <div style={styles.gridMain}>
        <LabeledField label="EMP ID">
          <input
            style={styles.input}
            value={form.employeeCode}
            onChange={(e) => setForm((p) => ({ ...p, employeeCode: e.target.value.toUpperCase() }))}
            placeholder="EMP ID"
            readOnly={isFieldReadOnly("employeeCode")}
          />
        </LabeledField>
        <LabeledField label="Name">
          <input
            style={styles.input}
            value={form.name}
            onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
            readOnly={isFieldReadOnly("name")}
          />
        </LabeledField>
        <LabeledField label="DOB">
          <input
            style={styles.input}
            type="date"
            value={form.dob}
            onChange={(e) => setForm((p) => ({ ...p, dob: e.target.value }))}
            readOnly={isFieldReadOnly("dob")}
          />
        </LabeledField>
        <LabeledField label="Address">
          <input
            style={styles.input}
            value={form.address}
            onChange={(e) => setForm((p) => ({ ...p, address: e.target.value }))}
            readOnly={isFieldReadOnly("address")}
          />
        </LabeledField>
        <LabeledField label="Belongs To">
          <select
            style={styles.input}
            value={form.belongsTo}
            onChange={(e) => setForm((p) => ({ ...p, belongsTo: e.target.value }))}
            disabled={isFieldReadOnly("belongsTo")}
          >
            <option value="">Select</option>
            {BELONGS_TO_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </LabeledField>
        <LabeledField label="Email">
          <input
            style={styles.input}
            value={form.email}
            onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))}
            readOnly={isFieldReadOnly("email")}
          />
        </LabeledField>

        <LabeledField label="CRM ID">
          <input
            style={styles.input}
            value={form.crmId}
            onChange={(e) => setForm((p) => ({ ...p, crmId: e.target.value }))}
            placeholder="Mail ID"
            readOnly={isFieldReadOnly("crmId")}
          />
        </LabeledField>

        <LabeledField label="Password">
          <div style={styles.passwordWrap}>
            <input
              style={{ ...styles.input, flex: 1 }}
              type={showPassword ? "text" : "password"}
              value={form.password}
              onChange={(e) => setForm((p) => ({ ...p, password: e.target.value }))}
              readOnly={isFieldReadOnly("password")}
            />
              <button type="button" style={styles.passwordBtn} onClick={() => setShowPassword((v) => !v)} disabled={isFieldReadOnly("password")}>
              {showPassword ? "Hide" : "View"}
            </button>
          </div>
        </LabeledField>

        <LabeledField label="Contact(ofc)">
          <input
            style={styles.input}
            value={form.officePhone}
            onChange={(e) => setForm((p) => ({ ...p, officePhone: e.target.value, phone: e.target.value }))}
            readOnly={isFieldReadOnly("officePhone")}
          />
        </LabeledField>
        <LabeledField label="Contact(pers)">
          <input
            style={styles.input}
            value={form.personalPhone}
            onChange={(e) => setForm((p) => ({ ...p, personalPhone: e.target.value }))}
            readOnly={isFieldReadOnly("personalPhone")}
          />
        </LabeledField>
        <LabeledField label="Emergency Contact">
          <input
            style={styles.input}
            value={form.emergencyContact}
            onChange={(e) => setForm((p) => ({ ...p, emergencyContact: e.target.value }))}
            readOnly={isFieldReadOnly("emergencyContact")}
          />
        </LabeledField>

        <LabeledField label="Role">
          <select
            style={styles.input}
            value={roleOptions.some((x) => x.value === form.role) ? form.role : "other"}
            onChange={(e) => onRoleChange(e.target.value)}
            disabled={isFieldReadOnly("role")}
          >
            <option value="">Select Role</option>
            {roleOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </LabeledField>

        {(form.role === "" || (roleOptions.some((x) => x.value === "other") && !roleOptions.some((x) => x.value === form.role))) && (
          <LabeledField label="Custom Role">
            <input
              style={styles.input}
              value={customRole}
              onChange={(e) => {
                const v = e.target.value;
                setCustomRole(v);
                setForm((p) => ({ ...p, role: v }));
              }}
              placeholder="exact Firestore value"
              readOnly={isFieldReadOnly("role")}
            />
          </LabeledField>
        )}

        <LabeledField label="Designation">
          <input
            style={styles.input}
            value={form.designation}
            onChange={(e) => setForm((p) => ({ ...p, designation: e.target.value }))}
            readOnly={isFieldReadOnly("designation")}
          />
        </LabeledField>
        <LabeledField label="Type">
          <select
            style={styles.input}
            value={form.employeeType}
            onChange={(e) => setForm((p) => ({ ...p, employeeType: e.target.value }))}
            disabled={isFieldReadOnly("employeeType")}
          >
            <option value="">Select</option>
            <option value="Onsite">Onsite</option>
            <option value="Off-site">Off-site</option>
            <option value="Remote">Remote</option>
          </select>
        </LabeledField>
        <LabeledField label="UAN">
          <input
            style={styles.input}
            value={form.uan}
            onChange={(e) => setForm((p) => ({ ...p, uan: e.target.value }))}
            readOnly={isFieldReadOnly("uan")}
          />
        </LabeledField>
        <LabeledField label="Package">
          <input
            style={styles.input}
            value={form.packageAmount}
            onChange={(e) => setForm((p) => ({ ...p, packageAmount: e.target.value }))}
            placeholder="5,50,000"
            readOnly={isFieldReadOnly("packageAmount")}
          />
        </LabeledField>
        <LabeledField label="Blood Group">
          <select
            style={styles.input}
            value={form.bloodGroup}
            onChange={(e) => setForm((p) => ({ ...p, bloodGroup: e.target.value }))}
            disabled={isFieldReadOnly("bloodGroup")}
          >
            <option value="">Select</option>
            <option value="A+">A+</option>
            <option value="A-">A-</option>
            <option value="B+">B+</option>
            <option value="B-">B-</option>
            <option value="O+">O+</option>
            <option value="O-">O-</option>
            <option value="AB+">AB+</option>
            <option value="AB-">AB-</option>
          </select>
        </LabeledField>
        <LabeledField label="Joining Date">
          <input
            style={styles.input}
            type="date"
            value={form.joiningDate}
            onChange={(e) => setForm((p) => ({ ...p, joiningDate: e.target.value }))}
            readOnly={isFieldReadOnly("joiningDate")}
          />
        </LabeledField>

        {roleKey === "telecaller" ? (
          <>
            {needsZone && (
              <LabeledField label="Sales Zone">
                <select
                  style={styles.input}
                  value={form.sales_zone}
                  onChange={(e) => setForm((p) => ({ ...p, sales_zone: e.target.value, sales_area: "", managerUID: "" }))}
                  disabled={isFieldReadOnly("sales_zone")}
                >
                  <option value="">Select</option>
                  {zones.map((z) => (
                    <option key={z.id} value={z.name}>{z.name}</option>
                  ))}
                </select>
              </LabeledField>
            )}
            {needsState && (
              <LabeledField label="State">
                <select
                  style={styles.input}
                  value={form.state}
                  onChange={(e) => setForm((p) => ({ ...p, state: e.target.value, managerUID: "" }))}
                  disabled={isFieldReadOnly("state")}
                >
                  <option value="">Select State</option>
                  {STATES.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </LabeledField>
            )}
          </>
        ) : (
          <>
            {needsState && (
              <LabeledField label="State">
                <select
                  style={styles.input}
                  value={form.state}
                  onChange={(e) => setForm((p) => ({ ...p, state: e.target.value, managerUID: "" }))}
                  disabled={isFieldReadOnly("state")}
                >
                  <option value="">Select State</option>
                  {STATES.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </LabeledField>
            )}

            {needsZone && (
              <LabeledField label="Sales Zone">
                <select
                  style={styles.input}
                  value={form.sales_zone}
                  onChange={(e) => setForm((p) => ({ ...p, sales_zone: e.target.value, sales_area: "", managerUID: "" }))}
                  disabled={isFieldReadOnly("sales_zone")}
                >
                  <option value="">Select</option>
                  {zones.map((z) => (
                    <option key={z.id} value={z.name}>{z.name}</option>
                  ))}
                </select>
              </LabeledField>
            )}

            {needsArea && (
              <LabeledField label="Sales Area">
                <select
                  style={styles.input}
                  value={form.sales_area}
                  onChange={(e) => setForm((p) => ({ ...p, sales_area: e.target.value, managerUID: "" }))}
                  disabled={isFieldReadOnly("sales_area")}
                >
                  <option value="">Select</option>
                  {areas.map((a) => (
                    <option key={a.id} value={a.name}>{a.name}</option>
                  ))}
                </select>
              </LabeledField>
            )}
          </>
        )}

        <LabeledField label="Reports To">
          <div style={styles.reportsWrap}>
            <input
              style={styles.input}
              value={reportsToInput}
              onFocus={() => canManageEmployees && setShowReportsList(true)}
              onBlur={() => canManageEmployees && window.setTimeout(() => setShowReportsList(false), 120)}
              onChange={(e) => {
                if (!canManageEmployees) return;
                setReportsToInput(e.target.value);
                setForm((p) => ({ ...p, managerUID: "", reportsTo: "" }));
                setShowReportsList(true);
              }}
              placeholder="search by name/email"
              readOnly={isFieldReadOnly("reportsTo")}
            />

            {showReportsList && !!filteredManagerOptions.length && canManageEmployees && (
              <div style={styles.reportsDropdown}>
                {filteredManagerOptions.map((m) => (
                  <button
                    type="button"
                    key={m.id}
                    style={styles.reportsItem}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      setReportsToInput(formatManagerOptionLabel(m));
                      setForm((p) => ({ ...p, managerUID: m.id, reportsTo: m.id }));
                      setShowReportsList(false);
                    }}
                  >
                    <div style={styles.reportsName}>{getUserName(m) || m.id}</div>
                    <div style={styles.reportsEmail}>{getUserEmail(m) || m.id}</div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </LabeledField>

        <LabeledField label="Hierarchy Level">
          <input style={styles.input} value={getLevelLabel(form.hierarchyLevel)} readOnly />
        </LabeledField>
        <LabeledField label="Status">
          <select
            style={styles.input}
            value={form.isActive ? "active" : "inactive"}
            onChange={(e) => setForm((p) => ({ ...p, isActive: e.target.value === "active" }))}
            disabled={isAdminRole || isFieldReadOnly("isActive")}
          >
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
          {isAdminRole && (
            <div style={{ fontSize: 11, color: "#7b0a0a", fontWeight: 600 }}>
              Admin users must stay active.
            </div>
          )}
        </LabeledField>
        <LabeledField label="Permissions">
          <div style={styles.permissionsList}>
            {normalizedPermissions.map((p) => (
              <span key={p} style={styles.permissionChip}>{p}</span>
            ))}
          </div>
        </LabeledField>
        </div>

        <div style={styles.actionRow}>
          {canSave && hasChanges && (
            <button style={styles.btnPrimary} onClick={onSave} disabled={saving}>
              {saving ? "Saving..." : isSelfMode ? "Update User" : (isExisting ? "Save Changes" : "Create User")}
            </button>
          )}
          {!canSave && (
            <div style={styles.noChangesText}>You do not have permission to update employees.</div>
          )}
          {isExisting && !hasChanges && <div style={styles.noChangesText}>No changes yet</div>}
        </div>
      </div>

      <div style={styles.cardSecondary}>
        <h4 style={styles.sectionTitleSmall}>Profile Photo</h4>
        <div style={styles.profilePhotoRow}>
          <div style={styles.profilePhotoShell}>
            {form.profilePhotoPreview || form.profilePhotoUrl ? (
              <img
                src={form.profilePhotoPreview || form.profilePhotoUrl}
                alt="Profile"
                style={styles.profilePhotoImg}
              />
            ) : (
              <div style={styles.profilePhotoPlaceholder}>👤</div>
            )}
          </div>
          <div style={styles.profilePhotoActions}>
            <input
              type="file"
              accept="image/*"
              style={styles.input}
              onChange={(e) => onUploadProfilePhoto(e.target.files?.[0])}
              disabled={uploadingProfile || !canManageDocs}
            />
            <div style={styles.helperText}>
              Upload a square image (JPG/PNG). It will appear in the top profile icon.
            </div>
            {(form.profilePhotoUrl || form.profilePhotoPreview) && (
              <button
                type="button"
                style={styles.btnDanger}
                onClick={async () => {
                  if (!canManageDocs) {
                    alert("You do not have permission to update employee photos.");
                    return;
                  }
                  const uid = String(uidInput || "").trim();
                  if (!uid) return;
                  if (!window.confirm("Delete this profile photo?")) return;
                  try {
                    await deleteEmployeeProfilePhoto(uid);
                    setForm((prev) => ({
                      ...prev,
                      profilePhotoUrl: "",
                      profilePhotoPath: "",
                      profilePhotoPreview: "",
                    }));
                    if (isSelfMode) {
                      try {
                        const stored = localStorage.getItem("kp-user");
                        const parsed = stored ? JSON.parse(stored) : null;
                        if (parsed && parsed.uid === uid) {
                          const next = { ...parsed };
                          delete next.profilePhotoUrl;
                          delete next.profilePhotoPath;
                          delete next.profilePhotoPreview;
                          localStorage.setItem("kp-user", JSON.stringify(next));
                          window.dispatchEvent(new CustomEvent("kp-login", { detail: next }));
                        }
                      } catch (e) {
                        console.warn("Failed to update local session after delete", e);
                      }
                    }
                  } catch (e) {
                    alert(e?.message || "Failed to delete profile photo");
                  }
                }}
                disabled={!canManageDocs}
              >
                Delete Photo
              </button>
            )}
          </div>
        </div>

        <h4 style={{ ...styles.sectionTitleSmall, marginTop: 16 }}>Attachments</h4>
        <div style={styles.gridAttachments}>
          <select style={styles.input} value={attachmentType} onChange={(e) => setAttachmentType(e.target.value)}>
            {isSelfMode ? (
              <>
                <option>Aadhaar</option>
                <option>PAN</option>
                <option>Document</option>
                <option>Other</option>
              </>
            ) : (
              <>
                <option>Document</option>
                <option>ID Proof</option>
                <option>Offer Letter</option>
                <option>Other</option>
              </>
            )}
          </select>
          <input
            type="file"
            style={styles.input}
            onChange={(e) => onUploadAttachment(e.target.files?.[0])}
            disabled={uploading || !canManageDocs}
          />
        </div>

        <div style={{ marginTop: 12 }}>
          {(form.attachments || []).map((a) => (
            <div key={a.id} style={styles.attachmentRow}>
              <div>
                <b>{a.fileName}</b>
                <div style={{ fontSize: 12, color: "#666" }}>{a.type || "Document"}</div>
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button
                  type="button"
                  style={styles.linkBtn}
                  onClick={() => {
                    try {
                      const w = window.open(a.url, "_blank", "noopener,noreferrer");
                      if (!w) window.location.href = a.url;
                    } catch (_) {
                      window.location.href = a.url;
                    }
                  }}
                >
                  View
                </button>
                <a href={a.url} download={a.fileName} style={styles.linkBtn}>Download</a>
                <button style={styles.btnDanger} onClick={() => onDeleteAttachment(a.id)}>Delete</button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

const styles = {
  wrapper: {
    display: "flex",
    flexDirection: "column",
    gap: 18,
  },
  card: {
    background: "#fff",
    border: "2px solid #8b0000",
    borderRadius: 24,
    padding: 18,
    boxShadow: "0 8px 24px rgba(0,0,0,0.05)",
  },
  cardSecondary: {
    background: "#fff",
    border: "2px solid #8b0000",
    borderRadius: 20,
    padding: 18,
    boxShadow: "0 6px 18px rgba(0,0,0,0.04)",
  },
  sectionTitle: {
    marginTop: 0,
    marginBottom: 8,
    color: "#800000",
  },
  sectionTitleSmall: {
    marginTop: 0,
    marginBottom: 12,
    color: "#800000",
  },
  gridHeader: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
    gap: 12,
    marginBottom: 10,
  },
  gridMain: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
    gap: 12,
  },
  gridAttachments: {
    display: "grid",
    gridTemplateColumns: "minmax(220px, 1fr) minmax(260px, 2fr)",
    gap: 12,
    alignItems: "center",
  },
  profilePhotoRow: {
    display: "grid",
    gridTemplateColumns: "120px 1fr",
    gap: 14,
    alignItems: "center",
  },
  profilePhotoShell: {
    width: 96,
    height: 96,
    borderRadius: "50%",
    border: "2px solid #8b0000",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "#fff",
    overflow: "hidden",
  },
  profilePhotoImg: {
    width: "100%",
    height: "100%",
    objectFit: "cover",
  },
  profilePhotoPlaceholder: {
    fontSize: 36,
    color: "#6b7280",
  },
  profilePhotoActions: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
  },
  helperText: {
    fontSize: 12,
    color: "#6b7280",
  },
  labeledField: {
    display: "grid",
    gridTemplateColumns: "120px 1fr",
    gap: 8,
    alignItems: "center",
  },
  fieldCaption: {
    fontSize: 12,
    fontWeight: 800,
    color: "#7b0a0a",
    letterSpacing: 0.2,
    textAlign: "left",
    whiteSpace: "nowrap",
  },
  fieldBody: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
    minWidth: 0,
  },
  modeText: {
    minHeight: 38,
    display: "flex",
    alignItems: "center",
    fontSize: 13,
    color: "#666",
    fontWeight: 600,
  },
  actionRow: {
    marginTop: 12,
    display: "flex",
    alignItems: "center",
    gap: 10,
  },
  permissionsList: {
    display: "flex",
    flexWrap: "wrap",
    gap: 6,
  },
  permissionChip: {
    background: "#fff1f2",
    border: "1px solid #fecdd3",
    color: "#7f1d1d",
    fontSize: 12,
    fontWeight: 700,
    padding: "4px 8px",
    borderRadius: 999,
  },
  reportsWrap: {
    position: "relative",
  },
  reportsDropdown: {
    position: "absolute",
    top: "calc(100% + 4px)",
    left: 0,
    right: 0,
    maxHeight: 220,
    overflowY: "auto",
    background: "#fff",
    border: "1px solid #d1d5db",
    borderRadius: 10,
    zIndex: 20,
    boxShadow: "0 12px 28px rgba(0,0,0,0.14)",
  },
  reportsItem: {
    width: "100%",
    textAlign: "left",
    border: "none",
    borderBottom: "1px solid #f1f5f9",
    background: "#fff",
    padding: "7px 10px",
    cursor: "pointer",
    fontSize: 12,
    lineHeight: 1.2,
  },
  reportsName: {
    fontWeight: 700,
    color: "#111827",
    fontSize: 12,
  },
  reportsEmail: {
    color: "#6b7280",
    fontSize: 11,
    marginTop: 2,
  },
  passwordWrap: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    width: "100%",
  },
  passwordBtn: {
    border: "1px solid #d1d5db",
    background: "#fff",
    color: "#111827",
    borderRadius: 6,
    padding: "8px 10px",
    cursor: "pointer",
    fontSize: 12,
    fontWeight: 600,
    minWidth: 58,
  },
  input: {
    border: "2px solid #8b0000",
    borderRadius: 6,
    padding: "8px 10px",
    background: "#fff",
    fontSize: 13,
    width: "100%",
    boxSizing: "border-box",
  },
  btnPrimary: {
    border: "1px solid #800000",
    background: "#800000",
    color: "#fff",
    borderRadius: 6,
    padding: "8px 12px",
    cursor: "pointer",
    fontWeight: 700,
  },
  btnSecondary: {
    border: "2px solid #8b0000",
    background: "#fff",
    color: "#8b0000",
    borderRadius: 6,
    padding: "8px 12px",
    cursor: "pointer",
    fontWeight: 700,
  },
  noChangesText: {
    color: "#6b7280",
    fontSize: 13,
    fontWeight: 600,
  },
  btnDanger: {
    border: "1px solid #b91c1c",
    background: "#ef4444",
    color: "#fff",
    borderRadius: 6,
    padding: "6px 10px",
    cursor: "pointer",
    fontWeight: 600,
  },
  linkBtn: {
    border: "1px solid #d1d5db",
    background: "#fff",
    color: "#111827",
    borderRadius: 6,
    padding: "6px 10px",
    textDecoration: "none",
    fontSize: 13,
  },
  attachmentRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    border: "1px solid #eee",
    borderRadius: 8,
    padding: 8,
    marginBottom: 8,
    background: "#fafafa",
  },
};
