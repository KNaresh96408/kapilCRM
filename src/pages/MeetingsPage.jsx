import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  updateDoc,
  serverTimestamp,
} from "firebase/firestore";
import { useLocation, useNavigate } from "react-router-dom";
import { db } from "../firebaseConfig";
import { useAuth } from "../context/AuthContext";
import { BRAND_MAROON_PURPLE_GRADIENT } from "../styles/brandTheme";
import kapilLogo from "../kapil-logo.png";

const normalizeRole = (value) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_")
    .replace(/_+/g, "_");

const canonicalRole = (value) => {
  const n = normalizeRole(value);
  const compact = n.replace(/_/g, "");
  if (compact === "saleshead") return "sales_head";
  if (compact === "teamlead") return "team_lead";
  return n;
};

const CREATOR_ROLES = new Set(["sales_head", "admin", "state_head", "team_lead", "zonal_manager"]);
const FULL_MEETING_ACCESS_ROLES = new Set(["admin", "sales_head"]);
const MEETING_DELETE_ROLES = new Set(["director", "admin", "sales_head", "agm", "dgm"]);

const normalizeScope = (value) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[^a-z0-9]/g, "");

const formatDateTime = (ms) => {
  if (!ms) return "-";
  try {
    return new Date(ms).toLocaleString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "-";
  }
};

const displayTarget = (meeting) => {
  const targetType = String(meeting?.targetType || "all").toLowerCase();
  const value = String(meeting?.targetValueLabel || meeting?.targetValue || "All Internal Members");
  if (targetType === "members") return `Selected Members: ${value}`;
  if (targetType === "zone") return `By Zone: ${value}`;
  if (targetType === "state") return `By State: ${value}`;
  return "To All";
};

const toMs = (value) => {
  const n = Number(value || 0);
  return Number.isFinite(n) ? n : 0;
};

const normalizeEmail = (value) => String(value || "").trim().toLowerCase();

const MEETING_BASE_URL = String(import.meta.env.VITE_MEETING_BASE_URL || "")
  .trim()
  .replace(/\/+$/, "");

const sanitizeMeetingBaseUrl = (rawUrl = "") => {
  const value = String(rawUrl || "").trim();
  if (!value) return "";
  if (!/^https?:\/\//i.test(value)) return "";
  try {
    const parsed = new URL(value);
    const host = String(parsed.hostname || "").toLowerCase();
    // Defensive: CRM app host serves SPA and returns 404 for /meet/* in current setup.
    if (host === "crm.kapilpower.com") return "";
    return value.replace(/\/+$/, "");
  } catch {
    return "";
  }
};

const SAFE_MEETING_BASE_URL = sanitizeMeetingBaseUrl(MEETING_BASE_URL);

const MEETING_HOST_LABEL = (() => {
  if (!SAFE_MEETING_BASE_URL) return "Not configured";
  try {
    return new URL(SAFE_MEETING_BASE_URL).host;
  } catch {
    return SAFE_MEETING_BASE_URL;
  }
})();

const sanitizeMeetingRoomName = (rawRoomName = "") =>
  String(rawRoomName || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);

const extractRoomFromMeetingLink = (rawLink = "") => {
  const value = String(rawLink || "").trim();
  if (!value) return "";
  try {
    const parsed = new URL(value);
    const roomSegment = decodeURIComponent(String(parsed.pathname || "").replace(/^\/+/, ""));
    return sanitizeMeetingRoomName(roomSegment);
  } catch {
    return "";
  }
};

const resolveMeetingRoomName = (meeting = {}) => {
  const roomFromDoc = sanitizeMeetingRoomName(String(meeting?.roomName || ""));
  if (roomFromDoc) return roomFromDoc;
  return extractRoomFromMeetingLink(String(meeting?.meetingLink || ""));
};

const buildRoomLink = (roomName) => {
  const room = sanitizeMeetingRoomName(roomName);
  if (!room || !SAFE_MEETING_BASE_URL) return "";
  return `${SAFE_MEETING_BASE_URL}/${encodeURIComponent(room)}`;
};

const resolveMeetingBaseLink = (meeting) => {
  const roomName = resolveMeetingRoomName(meeting);

  if (roomName && SAFE_MEETING_BASE_URL) {
    return `${SAFE_MEETING_BASE_URL}/${encodeURIComponent(roomName)}`;
  }

  const directLink = String(meeting?.meetingLink || "").trim();
  if (/^https?:\/\//i.test(directLink)) return directLink.replace(/\/+$/, "");

  return "";
};

const getLiveStatusLabel = (meeting, nowMs) => {
  const startMs = toMs(meeting?.startAtMillis);
  const endMs = toMs(meeting?.endAtMillis);
  if (!startMs || !endMs) return "";
  if (nowMs < startMs) return "Scheduled";
  if (nowMs > endMs) return "Ended";
  return "Live now · Waiting for others to join";
};

const buildJoinUrl = (meeting) => {
  const base = resolveMeetingBaseLink(meeting);
  if (!base) return "";

  const cleanBase = base.split("#")[0];
  const hashConfig = "#config.prejoinPageEnabled=false&config.disableDeepLinking=true";
  return `${cleanBase}${hashConfig}`;
};

const EARLY_JOIN_WINDOW_MS = 10 * 60 * 1000;

export default function MeetingsPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, roleData } = useAuth();
  const autoJoinHandledRef = useRef(new Set());

  const sessionUser = (() => {
    try {
      return JSON.parse(localStorage.getItem("kp-user") || "{}");
    } catch {
      return {};
    }
  })();

  const profile = {
    uid: user?.uid || sessionUser?.uid || "",
    email: String(user?.email || sessionUser?.email || "").trim().toLowerCase(),
    role: roleData?.role || user?.role || sessionUser?.role || sessionUser?.Role || "",
    state: sessionUser?.state || sessionUser?.state_label || sessionUser?.profile?.state || "",
    sales_zone:
      sessionUser?.sales_zone ||
      sessionUser?.salesZone ||
      sessionUser?.sales_zone_label ||
      sessionUser?.profile?.sales_zone ||
      sessionUser?.profile?.salesZone ||
      "",
  };

  const myRole = canonicalRole(profile.role);
  const canCreate = CREATOR_ROLES.has(myRole);

  const [meetings, setMeetings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [states, setStates] = useState([]);
  const [zones, setZones] = useState([]);
  const [directoryUsers, setDirectoryUsers] = useState([]);
  const [memberQuery, setMemberQuery] = useState("");
  const [showMemberSuggest, setShowMemberSuggest] = useState(false);
  const [saving, setSaving] = useState(false);
  const [joinUrl, setJoinUrl] = useState("");
  const [joinLoading, setJoinLoading] = useState(false);
  const [deletingId, setDeletingId] = useState("");
  const [resendingId, setResendingId] = useState("");
  const [activeTab, setActiveTab] = useState("upcoming");
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [joinError, setJoinError] = useState("");
  const [form, setForm] = useState({
    title: "",
    agenda: "",
    date: "",
    fromTime: "",
    toTime: "",
    targetType: "all",
    targetValue: "",
    selectedMembers: [],
  });

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 15000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!joinUrl || !joinLoading) return;
    const timer = window.setTimeout(() => {
      setJoinLoading(false);
      setJoinError(`Could not load meeting server (${MEETING_HOST_LABEL}). Please check DNS/SSL and try again.`);
    }, 15000);
    return () => window.clearTimeout(timer);
  }, [joinUrl, joinLoading]);

  useEffect(() => {
    const loadScopeOptions = async () => {
      try {
        const snap = await getDocs(query(collection(db, "Users"), limit(1000)));
        const users = snap.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));

        const stateSet = new Set();
        const zoneSet = new Set();

        users.forEach((u) => {
          const s = String(u.state || u.state_label || "").trim();
          const z = String(u.sales_zone || u.salesZone || u.sales_zone_label || "").trim();
          if (s) stateSet.add(s);
          if (z) zoneSet.add(z);
        });

        const directory = users
          .map((u) => ({
            uid: String(u.id || "").trim(),
            name: String(u.Name || u.name || u.displayName || "").trim(),
            email: String(u.email || u.Email || "").trim().toLowerCase(),
            role: canonicalRole(u.role || u.Role || u.designation || ""),
            state: String(u.state || u.state_label || "").trim(),
            sales_zone: String(u.sales_zone || u.salesZone || u.sales_zone_label || "").trim(),
          }))
          .filter((u) => u.uid && u.email)
          .sort((a, b) => (a.name || a.email).localeCompare(b.name || b.email));

        setStates(Array.from(stateSet).sort((a, b) => a.localeCompare(b)));
        setZones(Array.from(zoneSet).sort((a, b) => a.localeCompare(b)));
        setDirectoryUsers(directory);
      } catch (e) {
        console.warn("Failed to load meeting scope options", e?.message || e);
      }
    };

    loadScopeOptions();
  }, []);

  useEffect(() => {
    const q = query(collection(db, "meetings"), orderBy("startAtMillis", "desc"), limit(300));
    const unsub = onSnapshot(
      q,
      (snap) => {
        setMeetings(snap.docs.map((d) => ({ id: d.id, ...(d.data() || {}) })));
        setLoading(false);
      },
      (err) => {
        console.warn("Meeting list load failed", err?.message || err);
        setLoading(false);
      }
    );

    return () => unsub();
  }, []);

  const matchedMeetings = useMemo(() => {
    return (meetings || [])
      .filter((m) => String(m.status || "scheduled").toLowerCase() === "scheduled")
      .filter((m) => {
        if (FULL_MEETING_ACCESS_ROLES.has(myRole)) return true;
        if (profile.uid && String(m.createdByUid || "").trim() === profile.uid) return true;
        const recipientUids = Array.isArray(m.recipientUids) ? m.recipientUids.map((x) => String(x || "").trim()) : [];
        if (profile.uid && recipientUids.includes(profile.uid)) return true;

        return false;
      })
      .sort((a, b) => Number(a.startAtMillis || 0) - Number(b.startAtMillis || 0));
  }, [meetings, myRole, profile.uid]);

  const upcomingMeetings = useMemo(
    () => matchedMeetings.filter((m) => toMs(m.endAtMillis) >= nowMs),
    [matchedMeetings, nowMs]
  );

  const previousMeetings = useMemo(
    () => matchedMeetings.filter((m) => toMs(m.endAtMillis) < nowMs),
    [matchedMeetings, nowMs]
  );

  const visibleMeetings = activeTab === "previous" ? previousMeetings : upcomingMeetings;

  const autoJoinMeetingId = useMemo(() => {
    try {
      return String(new URLSearchParams(location.search).get("join") || "").trim();
    } catch {
      return "";
    }
  }, [location.search]);

  useEffect(() => {
    if (!autoJoinMeetingId) return;
    if (autoJoinHandledRef.current.has(autoJoinMeetingId)) return;

    const target = (meetings || []).find((m) => String(m.id || "").trim() === autoJoinMeetingId);
    if (!target) return;

    const startMs = toMs(target.startAtMillis);
    if (startMs && startMs > Date.now() + EARLY_JOIN_WINDOW_MS) {
      autoJoinHandledRef.current.add(autoJoinMeetingId);
      alert(`You can join from ${formatDateTime(startMs - EARLY_JOIN_WINDOW_MS)} (10 min before start).`);
      return;
    }

    const url = buildJoinUrl(target);
    if (!url) return;

    autoJoinHandledRef.current.add(autoJoinMeetingId);
    setJoinError("");
    setJoinLoading(true);
    setJoinUrl(url);
  }, [autoJoinMeetingId, meetings]);

  const canDeleteMeeting = (meeting) => {
    const creatorUid = String(meeting?.createdByUid || "").trim();
    return MEETING_DELETE_ROLES.has(myRole) || (!!profile.uid && creatorUid === profile.uid);
  };

  const canResendMeetingInvite = (meeting) => {
    const creatorUid = String(meeting?.createdByUid || "").trim();
    return MEETING_DELETE_ROLES.has(myRole) || FULL_MEETING_ACCESS_ROLES.has(myRole) || (!!profile.uid && creatorUid === profile.uid);
  };

  const updateField = (field, value) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const memberSuggestions = useMemo(() => {
    if (form.targetType !== "members") return [];
    const q = String(memberQuery || "").trim().toLowerCase();
    const selectedSet = new Set((form.selectedMembers || []).map((u) => String(u.uid || "").trim()));
    return directoryUsers
      .filter((u) => !selectedSet.has(u.uid))
      .filter((u) => {
        if (!q) return true;
        return String(u.name || "").toLowerCase().includes(q) || String(u.email || "").toLowerCase().includes(q);
      })
      .slice(0, 12);
  }, [directoryUsers, form.selectedMembers, form.targetType, memberQuery]);

  const addSelectedMember = (member) => {
    if (!member?.uid) return;
    setForm((prev) => {
      const exists = (prev.selectedMembers || []).some((x) => String(x.uid || "") === String(member.uid || ""));
      if (exists) return prev;
      return { ...prev, selectedMembers: [...(prev.selectedMembers || []), member] };
    });
    setMemberQuery("");
    setShowMemberSuggest(true);
  };

  const removeSelectedMember = (uid) => {
    setForm((prev) => ({
      ...prev,
      selectedMembers: (prev.selectedMembers || []).filter((x) => String(x.uid || "") !== String(uid || "")),
    }));
  };

  const validateForm = () => {
    if (!String(form.title || "").trim()) return "Meeting title is required.";
    if (!form.date || !form.fromTime || !form.toTime) return "Please select date, start time and end time.";

    const start = new Date(`${form.date}T${form.fromTime}:00`);
    const end = new Date(`${form.date}T${form.toTime}:00`);

    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      return "Invalid date/time selected.";
    }
    if (end <= start) return "End time must be greater than start time.";

    if (form.targetType === "members" && !(form.selectedMembers || []).length) {
      return "Please select at least one member.";
    }

    if (form.targetType !== "all" && form.targetType !== "members" && !String(form.targetValue || "").trim()) {
      return `Please select ${form.targetType}.`;
    }

    return "";
  };

  const resolveRecipientUsers = (targetType, targetValue, selectedMembers = []) => {
    const type = String(targetType || "all").trim().toLowerCase();
    const creatorZoneNorm = normalizeScope(profile.sales_zone);
    if (type === "members") {
      return (selectedMembers || [])
        .map((m) => ({
          uid: String(m.uid || "").trim(),
          email: normalizeEmail(m.email),
          name: String(m.name || "").trim(),
          zoneNorm: normalizeScope(m.sales_zone),
        }))
        .filter((m) => m.uid && m.email)
        .filter((m) => (myRole === "zonal_manager" ? m.zoneNorm === creatorZoneNorm : true))
        .map((m) => ({ uid: m.uid, email: m.email, name: m.name }));
    }

    const valueNorm = normalizeScope(targetValue);
    return (directoryUsers || [])
      .filter((u) => {
        if (!u?.uid || !u?.email) return false;
        if (type === "all") {
          if (myRole === "zonal_manager") return normalizeScope(u.sales_zone) === creatorZoneNorm;
          return true;
        }
        if (type === "state") return normalizeScope(u.state) === valueNorm;
        if (type === "zone") return normalizeScope(u.sales_zone) === valueNorm;
        return false;
      })
      .map((u) => ({
        uid: String(u.uid || "").trim(),
        email: normalizeEmail(u.email),
        name: String(u.name || "").trim(),
      }));
  };

  const createMeeting = async () => {
    if (!canCreate) {
      alert("Only Sales Head, Admin, State Head, Team Lead and Zonal Manager can create meetings.");
      return;
    }

    if (!SAFE_MEETING_BASE_URL) {
      alert("Meeting base URL is not configured. Set VITE_MEETING_BASE_URL to your self-hosted/JaaS domain.");
      return;
    }

    const error = validateForm();
    if (error) {
      alert(error);
      return;
    }

    const start = new Date(`${form.date}T${form.fromTime}:00`);
    const end = new Date(`${form.date}T${form.toTime}:00`);
    const roomName = sanitizeMeetingRoomName(`kpcrm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    const selectedMembers = (form.selectedMembers || []).map((m) => ({
      uid: String(m.uid || "").trim(),
      email: String(m.email || "").trim().toLowerCase(),
      name: String(m.name || "").trim(),
      sales_zone: String(m.sales_zone || "").trim(),
    })).filter((m) => m.uid && m.email);

    const zonalManagerZone = String(profile.sales_zone || "").trim();
    const isZonalManager = myRole === "zonal_manager";
    if (isZonalManager && !zonalManagerZone) {
      alert("Your zone is missing in profile. Please contact admin.");
      return;
    }

    const effectiveTargetType = isZonalManager && form.targetType !== "members" ? "zone" : form.targetType;
    const effectiveTargetValue =
      effectiveTargetType === "zone" && isZonalManager
        ? zonalManagerZone
        : form.targetType === "all" || form.targetType === "members"
          ? ""
          : String(form.targetValue || "").trim();

    const resolvedRecipients = resolveRecipientUsers(effectiveTargetType, effectiveTargetValue, selectedMembers);

    const creatorUidNorm = String(profile.uid || "").trim();
    const creatorEmailNorm = normalizeEmail(profile.email);
    const hasCreatorInRecipients = resolvedRecipients.some((r) => String(r.uid || "").trim() === creatorUidNorm);
    const normalizedRecipients = hasCreatorInRecipients
      ? resolvedRecipients
      : [
        ...resolvedRecipients,
        {
          uid: creatorUidNorm,
          email: creatorEmailNorm,
          name: "",
        },
      ].filter((r) => r.uid && r.email);

    setSaving(true);
    try {
      const payload = {
        title: String(form.title || "").trim(),
        agenda: String(form.agenda || "").trim(),
        targetType: effectiveTargetType,
        targetValue: effectiveTargetType === "all" || effectiveTargetType === "members" ? "" : effectiveTargetValue,
        targetValueNorm: effectiveTargetType === "all" || effectiveTargetType === "members" ? "" : normalizeScope(effectiveTargetValue),
        targetValueLabel:
          effectiveTargetType === "all"
            ? "All Internal Members"
            : effectiveTargetType === "members"
              ? selectedMembers.map((m) => m.name || m.email).join(", ")
              : String(effectiveTargetValue || "").trim(),
        roomName,
        meetingLink: buildRoomLink(roomName),
        startAt: start.toISOString(),
        endAt: end.toISOString(),
        startAtMillis: start.getTime(),
        endAtMillis: end.getTime(),
        reminderAtMillis: start.getTime() - 60 * 60 * 1000,
        reminderSentAt: null,
        recipientUids: normalizedRecipients.map((m) => m.uid),
        recipientEmails: normalizedRecipients.map((m) => m.email),
        createdByUid: profile.uid || "",
        createdByEmail: profile.email || "",
        createdByRole: myRole,
        status: "scheduled",
        active: true,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };

      await addDoc(collection(db, "meetings"), payload);

      alert(`Meeting created on ${MEETING_HOST_LABEL}. Invites and notifications will be sent automatically.`);
      setForm({
        title: "",
        agenda: "",
        date: "",
        fromTime: "",
        toTime: "",
        targetType: "all",
        targetValue: "",
        selectedMembers: [],
      });
      setMemberQuery("");
      setShowMemberSuggest(false);
    } catch (e) {
      console.error("Create meeting failed", e);
      alert(e?.message || "Failed to create meeting.");
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteMeeting = async (meeting) => {
    const id = String(meeting?.id || "").trim();
    if (!id || deletingId) return;
    if (!canDeleteMeeting(meeting)) {
      alert("Only creator or Director/Admin/Sales Head/AGM/DGM can delete this meeting.");
      return;
    }

    const yes = window.confirm("Delete this meeting?");
    if (!yes) return;

    setDeletingId(id);
    try {
      await deleteDoc(doc(db, "meetings", id));
    } catch (e) {
      console.error("Delete meeting failed", e);
      alert(e?.message || "Failed to delete meeting.");
    } finally {
      setDeletingId("");
    }
  };

  const handleResendInvite = async (meeting) => {
    const id = String(meeting?.id || "").trim();
    if (!id || resendingId) return;
    if (!canResendMeetingInvite(meeting)) {
      alert("You are not allowed to resend invites for this meeting.");
      return;
    }

    const yes = window.confirm("Resend meeting invite to recipients now?");
    if (!yes) return;

    setResendingId(id);
    try {
      await updateDoc(doc(db, "meetings", id), {
        resendRequestedAt: serverTimestamp(),
        resendRequestedByUid: profile.uid || "",
        resendRequestedByRole: myRole || "",
        resendDispatchState: "queued",
        updatedAt: serverTimestamp(),
      });
      alert("Invite resend queued.");
    } catch (e) {
      console.error("Resend invite failed", e);
      alert(e?.message || "Failed to resend invite.");
    } finally {
      setResendingId("");
    }
  };

  return (
    <div style={styles.page}>
      <div style={styles.headerBar}>
        <button style={styles.backBtn} onClick={() => navigate("/apps")}>← Apps</button>
        <h2 style={styles.title}>Internal Meetings</h2>
      </div>

      <div style={SAFE_MEETING_BASE_URL ? styles.meetingHostInfo : styles.meetingHostWarn}>
        <strong>Meeting server:</strong> {MEETING_HOST_LABEL}
        <span style={styles.meetingHostMeta}>
          {SAFE_MEETING_BASE_URL ? ` (${SAFE_MEETING_BASE_URL})` : " (Set VITE_MEETING_BASE_URL to self-hosted/JaaS URL)"}
        </span>
      </div>

      {canCreate ? (
        <div style={styles.createCard}>
          <h3 style={styles.cardTitle}>Create Meeting</h3>

          <input
            style={styles.input}
            placeholder="Meeting title"
            value={form.title}
            onChange={(e) => updateField("title", e.target.value)}
          />

          <textarea
            style={{ ...styles.input, minHeight: 70, resize: "vertical" }}
            placeholder="Agenda / notes (optional)"
            value={form.agenda}
            onChange={(e) => updateField("agenda", e.target.value)}
          />

          <div style={styles.row}>
            <input
              style={styles.input}
              type="date"
              value={form.date}
              onChange={(e) => updateField("date", e.target.value)}
            />
            <input
              style={styles.input}
              type="time"
              value={form.fromTime}
              onChange={(e) => updateField("fromTime", e.target.value)}
            />
            <input
              style={styles.input}
              type="time"
              value={form.toTime}
              onChange={(e) => updateField("toTime", e.target.value)}
            />
          </div>

          <div style={styles.row}>
            <select
              style={styles.input}
              value={form.targetType}
              onChange={(e) => {
                const nextType = e.target.value;
                setForm((prev) => ({ ...prev, targetType: nextType, targetValue: "" }));
                setMemberQuery("");
                setShowMemberSuggest(false);
              }}
            >
              <option value="all">To All</option>
              <option value="state">By State</option>
              <option value="zone">By Zone</option>
              <option value="members">Select Members</option>
            </select>

            {form.targetType === "state" && (
              <select
                style={styles.input}
                value={form.targetValue}
                onChange={(e) => updateField("targetValue", e.target.value)}
              >
                <option value="">Select state</option>
                {states.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            )}

            {form.targetType === "zone" && (
              <select
                style={styles.input}
                value={form.targetValue}
                onChange={(e) => updateField("targetValue", e.target.value)}
              >
                <option value="">Select zone</option>
                {zones.map((z) => (
                  <option key={z} value={z}>{z}</option>
                ))}
              </select>
            )}

            {form.targetType === "members" && (
              <div style={styles.memberWrap}>
                <input
                  style={{ ...styles.input, marginBottom: 0 }}
                  placeholder="Enter username / email"
                  value={memberQuery}
                  onFocus={() => setShowMemberSuggest(true)}
                  onBlur={() => setTimeout(() => setShowMemberSuggest(false), 120)}
                  onChange={(e) => {
                    setMemberQuery(e.target.value);
                    setShowMemberSuggest(true);
                  }}
                />

                {!!(form.selectedMembers || []).length && (
                  <div style={styles.memberChipRow}>
                    {(form.selectedMembers || []).map((m) => (
                      <span key={m.uid} style={styles.memberChip}>
                        {m.name || m.email}
                        <button type="button" style={styles.memberChipBtn} onClick={() => removeSelectedMember(m.uid)}>×</button>
                      </span>
                    ))}
                  </div>
                )}

                {showMemberSuggest && memberSuggestions.length > 0 && (
                  <div style={styles.memberSuggestBox}>
                    {memberSuggestions.map((u) => (
                      <button
                        key={`member-${u.uid}`}
                        type="button"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => addSelectedMember(u)}
                        style={styles.memberSuggestBtn}
                      >
                        <div style={{ fontWeight: 700, color: "#2f2a2f" }}>{u.name || u.email}</div>
                        <div style={{ color: "#766a77", fontSize: 12 }}>{u.email}</div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          <button style={styles.primaryBtn} disabled={saving} onClick={createMeeting}>
            {saving ? "Creating..." : "Create Meet"}
          </button>

          <p style={styles.hint}>
            On create: internal mail + app/web notification is sent immediately, and reminder is sent again 1 hour before meeting.
          </p>
        </div>
      ) : (
        <div style={styles.noCreate}>You can join meetings, but only Sales Head/Admin/State Head/Team Lead/Zonal Manager can create meetings.</div>
      )}

      <div style={styles.listCard}>
        <div style={styles.tabRow}>
          <button
            type="button"
            style={{ ...styles.tabBtn, ...(activeTab === "upcoming" ? styles.tabBtnActive : null) }}
            onClick={() => setActiveTab("upcoming")}
          >
            Upcoming Meetings ({upcomingMeetings.length})
          </button>
          <button
            type="button"
            style={{ ...styles.tabBtn, ...(activeTab === "previous" ? styles.tabBtnActive : null) }}
            onClick={() => setActiveTab("previous")}
          >
            Previous Meetings ({previousMeetings.length})
          </button>
        </div>

        {loading && <p style={styles.subtle}>Loading meetings…</p>}
        {!loading && !visibleMeetings.length && (
          <p style={styles.subtle}>{activeTab === "previous" ? "No previous meetings." : "No upcoming meetings."}</p>
        )}

        {!!visibleMeetings.length && (
          <div style={styles.list}>
            {visibleMeetings.map((m) => (
              <div key={m.id} style={styles.item}>
                <div>
                  <div style={styles.itemTitle}>{m.title || "Untitled Meeting"}</div>
                  <div style={styles.itemMeta}>{formatDateTime(m.startAtMillis)} → {formatDateTime(m.endAtMillis)}</div>
                  <div style={styles.itemMeta}>{displayTarget(m)}</div>
                  <div style={styles.liveMeta}>{getLiveStatusLabel(m, nowMs)}</div>
                  {m.agenda ? <div style={styles.agenda}>{m.agenda}</div> : null}
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                  {toMs(m.endAtMillis) >= nowMs && (
                    <button
                      type="button"
                      style={styles.joinBtn}
                      onClick={() => {
                        const startMs = toMs(m.startAtMillis);
                        if (startMs > Date.now() + EARLY_JOIN_WINDOW_MS) {
                          alert(`You can join from ${formatDateTime(startMs - EARLY_JOIN_WINDOW_MS)} (10 min before start).`);
                          return;
                        }
                        const url = buildJoinUrl(m);
                        if (!url) {
                          alert("Meeting link is missing.");
                          return;
                        }
                        setJoinError("");
                        setJoinLoading(true);
                        setJoinUrl(url);
                      }}
                    >
                      Join Meeting
                    </button>
                  )}

                  {toMs(m.endAtMillis) >= nowMs && canResendMeetingInvite(m) && (
                    <button
                      type="button"
                      style={{ ...styles.resendBtn, opacity: resendingId === m.id ? 0.75 : 1 }}
                      disabled={resendingId === m.id}
                      onClick={() => handleResendInvite(m)}
                    >
                      {resendingId === m.id ? "Resending..." : "Resend Invite"}
                    </button>
                  )}

                  {canDeleteMeeting(m) && (
                    <button
                      type="button"
                      style={{ ...styles.deleteBtn, opacity: deletingId === m.id ? 0.7 : 1 }}
                      disabled={deletingId === m.id}
                      onClick={() => handleDeleteMeeting(m)}
                    >
                      {deletingId === m.id ? "Deleting..." : "Delete"}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {joinUrl && (
        <div style={styles.overlay} onClick={() => setJoinUrl("")}>
          <div style={styles.joinWrap} onClick={(e) => e.stopPropagation()}>
            <div style={styles.joinHead}>
              <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                <strong style={{ color: "#fff" }}>Meeting Room</strong>
                <span style={styles.joinServerLabel}>Server: {MEETING_HOST_LABEL}</span>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button style={styles.headBtn} onClick={() => window.open(joinUrl, "_blank", "noopener,noreferrer")}>Open new tab</button>
                <button
                  style={styles.headBtn}
                  onClick={() => {
                    setJoinLoading(false);
                    setJoinError("");
                    setJoinUrl("");
                  }}
                >
                  Close
                </button>
              </div>
            </div>
            {joinLoading && (
              <div style={styles.joinLoader}>
                <img src={kapilLogo} alt="Kapil" style={styles.joinLogo} />
                <div style={styles.joinLoaderTitle}>Kapil Power Meetings</div>
                <div style={styles.joinLoaderSub}>Loading meeting room…</div>
              </div>
            )}
            <iframe
              title="Meeting"
              src={joinUrl}
              allow="camera; microphone; fullscreen; display-capture"
              style={styles.iframe}
              onLoad={() => {
                setJoinLoading(false);
                setJoinError("");
              }}
              onError={() => {
                setJoinLoading(false);
                setJoinError(`Could not reach meeting server (${MEETING_HOST_LABEL}).`);
              }}
            />
            {!!joinError && (
              <div style={styles.joinErrorBar}>{joinError}</div>
            )}
            {!joinLoading && (
              <div style={styles.joinInfoBar}>If others are not inside yet, keep this room open — waiting for others to join.</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

const styles = {
  page: {
    minHeight: "100dvh",
    padding: 16,
    background: BRAND_MAROON_PURPLE_GRADIENT,
  },
  headerBar: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    marginBottom: 12,
  },
  backBtn: {
    border: "1px solid rgba(255,255,255,0.65)",
    background: "transparent",
    color: "#fff",
    borderRadius: 10,
    padding: "8px 12px",
    cursor: "pointer",
    fontWeight: 700,
  },
  title: {
    margin: 0,
    color: "#fff",
    fontSize: 26,
  },
  meetingHostInfo: {
    marginBottom: 12,
    padding: "10px 12px",
    borderRadius: 10,
    background: "rgba(236,253,243,0.95)",
    border: "1px solid #86efac",
    color: "#14532d",
    fontSize: 13,
  },
  meetingHostWarn: {
    marginBottom: 12,
    padding: "10px 12px",
    borderRadius: 10,
    background: "rgba(254,242,242,0.95)",
    border: "1px solid #fca5a5",
    color: "#7f1d1d",
    fontSize: 13,
  },
  meetingHostMeta: {
    opacity: 0.92,
  },
  createCard: {
    background: "rgba(255,255,255,0.1)",
    border: "1px solid rgba(255,255,255,0.2)",
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
  },
  listCard: {
    background: "rgba(255,255,255,0.1)",
    border: "1px solid rgba(255,255,255,0.2)",
    borderRadius: 12,
    padding: 12,
  },
  cardTitle: {
    margin: "0 0 10px",
    color: "#fff",
  },
  input: {
    width: "100%",
    boxSizing: "border-box",
    borderRadius: 8,
    border: "1px solid #d8c7db",
    padding: "9px 10px",
    background: "#fff",
    marginBottom: 8,
  },
  row: {
    display: "grid",
    gap: 8,
    gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))",
  },
  memberWrap: {
    position: "relative",
  },
  memberChipRow: {
    display: "flex",
    flexWrap: "wrap",
    gap: 6,
    marginTop: 8,
  },
  memberChip: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    borderRadius: 999,
    background: "#f6e5ee",
    color: "#6f0f29",
    border: "1px solid #e7bfd0",
    padding: "4px 9px",
    fontSize: 12,
    fontWeight: 700,
  },
  memberChipBtn: {
    border: 0,
    background: "transparent",
    color: "#6f0f29",
    cursor: "pointer",
    fontSize: 14,
    lineHeight: 1,
    fontWeight: 700,
    padding: 0,
  },
  memberSuggestBox: {
    position: "absolute",
    top: "calc(100% + 6px)",
    left: 0,
    right: 0,
    background: "#fff",
    border: "1px solid #ddd0df",
    borderRadius: 10,
    boxShadow: "0 10px 24px rgba(0,0,0,0.14)",
    maxHeight: 220,
    overflowY: "auto",
    zIndex: 1000,
  },
  memberSuggestBtn: {
    width: "100%",
    textAlign: "left",
    border: 0,
    background: "#fff",
    cursor: "pointer",
    padding: "8px 10px",
    borderBottom: "1px solid #f2ebf3",
  },
  primaryBtn: {
    border: 0,
    borderRadius: 10,
    background: "linear-gradient(135deg,#8f1123,#5e167a)",
    color: "#fff",
    fontWeight: 700,
    padding: "10px 14px",
    cursor: "pointer",
    marginTop: 6,
  },
  hint: {
    margin: "10px 0 0",
    fontSize: 12,
    color: "#eef2ff",
  },
  noCreate: {
    marginBottom: 12,
    padding: 12,
    borderRadius: 12,
    background: "rgba(255,255,255,0.1)",
    border: "1px solid rgba(255,255,255,0.2)",
    color: "#fff",
  },
  subtle: {
    margin: 0,
    color: "#f4f7ff",
  },
  tabRow: {
    display: "flex",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 10,
  },
  tabBtn: {
    border: "1px solid rgba(255,255,255,0.4)",
    background: "rgba(255,255,255,0.1)",
    color: "#fff",
    borderRadius: 999,
    padding: "8px 12px",
    cursor: "pointer",
    fontWeight: 700,
    fontSize: 13,
  },
  tabBtnActive: {
    background: "#fff",
    color: "#6f0f29",
    border: "1px solid #fff",
  },
  list: {
    display: "flex",
    flexDirection: "column",
    gap: 10,
  },
  item: {
    border: "1px solid #eadfeb",
    borderRadius: 10,
    padding: 10,
    background: "#fff",
    display: "flex",
    justifyContent: "space-between",
    gap: 10,
    flexWrap: "wrap",
  },
  itemTitle: {
    fontWeight: 700,
    color: "#2e2733",
    marginBottom: 4,
  },
  itemMeta: {
    color: "#6b6370",
    fontSize: 13,
    marginBottom: 2,
  },
  liveMeta: {
    color: "#8f1123",
    fontSize: 12,
    fontWeight: 700,
    marginTop: 4,
  },
  agenda: {
    marginTop: 6,
    color: "#40394a",
    fontSize: 13,
    whiteSpace: "pre-wrap",
  },
  joinBtn: {
    border: 0,
    borderRadius: 8,
    background: "#0f62fe",
    color: "#fff",
    fontWeight: 700,
    padding: "8px 12px",
    cursor: "pointer",
  },
  deleteBtn: {
    border: "1px solid #b52b27",
    borderRadius: 8,
    background: "#fff",
    color: "#b52b27",
    fontWeight: 700,
    padding: "8px 12px",
    cursor: "pointer",
  },
  resendBtn: {
    border: "1px solid #14532d",
    borderRadius: 8,
    background: "#ecfdf3",
    color: "#14532d",
    fontWeight: 700,
    padding: "8px 12px",
    cursor: "pointer",
  },
  overlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,0.7)",
    zIndex: 999999,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 8,
  },
  joinWrap: {
    width: "min(1280px, 100%)",
    height: "min(760px, 100%)",
    borderRadius: 12,
    overflow: "hidden",
    border: "1px solid rgba(255,255,255,0.2)",
    background: "#0b1120",
    display: "flex",
    flexDirection: "column",
    position: "relative",
  },
  joinHead: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 10,
    background: "linear-gradient(90deg,#8f1123,#5e167a)",
  },
  headBtn: {
    border: "1px solid rgba(255,255,255,0.55)",
    background: "rgba(255,255,255,0.1)",
    color: "#fff",
    borderRadius: 8,
    padding: "6px 10px",
    cursor: "pointer",
    fontWeight: 600,
  },
  joinServerLabel: {
    color: "#dbeafe",
    fontSize: 11,
    fontWeight: 600,
    opacity: 0.95,
  },
  iframe: {
    flex: 1,
    width: "100%",
    border: 0,
    background: "#000",
  },
  joinLoader: {
    position: "absolute",
    inset: 0,
    background: "#0b1120",
    zIndex: 2,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  joinLogo: {
    width: 92,
    height: 92,
    borderRadius: 10,
    border: "1px solid rgba(255,255,255,0.22)",
    background: "#fff",
    objectFit: "contain",
  },
  joinLoaderTitle: {
    color: "#fff",
    fontSize: 22,
    fontWeight: 800,
  },
  joinLoaderSub: {
    color: "#c9d5ff",
    fontSize: 13,
  },
  joinInfoBar: {
    position: "absolute",
    bottom: 12,
    left: "50%",
    transform: "translateX(-50%)",
    background: "rgba(11,17,32,0.86)",
    color: "#e8edff",
    border: "1px solid rgba(255,255,255,0.2)",
    borderRadius: 999,
    padding: "6px 12px",
    fontSize: 12,
    fontWeight: 600,
    zIndex: 3,
    pointerEvents: "none",
  },
  joinErrorBar: {
    position: "absolute",
    bottom: 48,
    left: "50%",
    transform: "translateX(-50%)",
    background: "rgba(127,29,29,0.94)",
    color: "#fff",
    border: "1px solid rgba(252,165,165,0.8)",
    borderRadius: 10,
    padding: "8px 12px",
    fontSize: 12,
    fontWeight: 700,
    zIndex: 4,
    maxWidth: "min(92%, 860px)",
    textAlign: "center",
  },
};
