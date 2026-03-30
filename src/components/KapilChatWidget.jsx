import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { LocalNotifications } from "@capacitor/local-notifications";
import {
  addDoc,
  collection,
  deleteField,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  orderBy,
  limit,
} from "firebase/firestore";
import { getDownloadURL, ref as storageRef, uploadBytes } from "firebase/storage";
import {
  FiCheckSquare,
  FiCheck,
  FiCheckCircle,
  FiCopy,
  FiCornerUpRight,
  FiInfo,
  FiMail,
  FiMaximize2,
  FiMinimize2,
  FiMessageCircle,
  FiMoreVertical,
  FiPaperclip,
  FiPhone,
  FiPlus,
  FiShare2,
  FiSend,
  FiSquare,
  FiX,
} from "react-icons/fi";
import { useLocation } from "react-router-dom";
import app, { auth, db, storage } from "../firebaseConfig";
import { fetchCollectionDocs } from "../helpers/firestoreFetch";
import { createDocumentREST, fieldsToObject, updateDocumentREST } from "../helpers/firestoreRest";
import { useAuth } from "../context/AuthContext";

const HIDDEN_PATHS = new Set([
  "/",
  "/forgot-password",
  "/verify-otp",
  "/reset-password-final",
]);

const DAY_MS = 24 * 60 * 60 * 1000;

const toMillis = (value) => {
  if (!value) return 0;
  if (typeof value?.toDate === "function") {
    const d = value.toDate();
    return Number.isNaN(d.getTime()) ? 0 : d.getTime();
  }
  if (value?.seconds) return Number(value.seconds) * 1000;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? 0 : d.getTime();
};

const getThreadActivityMillis = (thread) => {
  return Math.max(
    toMillis(thread?.lastMessageAt),
    toMillis(thread?.createdAt)
  );
};

const getThreadActivityValue = (thread) => {
  if (!thread) return null;
  return thread?.lastMessageAt || thread?.createdAt || null;
};

const compareThreadsByActivity = (a, b) => {
  const diff = getThreadActivityMillis(b) - getThreadActivityMillis(a);
  if (diff !== 0) return diff;
  return String(a?.id || "").localeCompare(String(b?.id || ""));
};

const getDmKeyForThread = (thread, myUid) => {
  if (!thread || thread.type === "group" || !myUid) return "";
  const directDmKey = String(thread.dmKey || "").trim();
  if (directDmKey) return directDmKey;

  const memberIds = Array.isArray(thread.memberIds) ? thread.memberIds.filter(Boolean) : [];
  let otherId = memberIds.find((id) => id !== myUid) || "";

  if (!otherId) {
    const metaIds = Object.keys(thread.memberMeta || {}).filter(Boolean);
    otherId = metaIds.find((id) => id !== myUid) || "";
  }

  if (!otherId) return "";
  return [myUid, otherId].sort().join("_");
};

const formatTime = (value) => {
  const ms = toMillis(value);
  if (!ms) return "";
  return new Date(ms).toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
};

const formatDateLabel = (value) => {
  const ms = toMillis(value);
  if (!ms) return "";
  const now = new Date();
  const d = new Date(ms);
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const dDayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diff = Math.floor((dayStart - dDayStart) / DAY_MS);
  if (diff === 0) return formatTime(value);
  if (diff === 1) return "Yesterday";
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
};

const formatDateTime = (value) => {
  const ms = toMillis(value);
  if (!ms) return "-";
  return new Date(ms).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
};

const normalizeEmail = (value) => String(value || "").trim().toLowerCase();

const safeName = (value) => String(value || "file").replace(/[^a-zA-Z0-9_.-]/g, "_");

const getSessionUser = () => {
  try {
    const raw = localStorage.getItem("kp-user");
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

const getUserIdentity = (ctxUser) => {
  const sessionUser = getSessionUser();
  const uid = String(
    ctxUser?.uid ||
      sessionUser?.uid ||
      sessionUser?.id ||
      sessionUser?.profile?.uid ||
      ""
  ).trim();
  const email = String(
    ctxUser?.email ||
      sessionUser?.email ||
      sessionUser?.Email ||
      sessionUser?.profile?.email ||
      ""
  )
    .trim()
    .toLowerCase();
  const name = String(
    ctxUser?.Name ||
      ctxUser?.name ||
      ctxUser?.displayName ||
      sessionUser?.Name ||
      sessionUser?.name ||
      sessionUser?.displayName ||
      email ||
      "User"
  ).trim();

  return { uid, email, name };
};

export default function KapilChatWidget() {
  const location = useLocation();
  const { user: ctxUser } = useAuth();
  const user = useMemo(() => getUserIdentity(ctxUser), [ctxUser]);
  const me = useMemo(() => {
    const sessionUser = getSessionUser();
    const sdkUid = String(auth?.currentUser?.uid || "").trim();
    const sdkEmail = String(auth?.currentUser?.email || "")
      .trim()
      .toLowerCase();

    const effectiveUid = user.uid || sdkUid;
    const effectiveEmail = user.email || sdkEmail;

    const sessionUid = String(
      sessionUser?.uid ||
      sessionUser?.id ||
      sessionUser?.profile?.uid ||
      ""
    ).trim();
    const sessionEmail = normalizeEmail(
      sessionUser?.email ||
      sessionUser?.Email ||
      sessionUser?.profile?.email
    );

    const ctxUid = String(ctxUser?.uid || "").trim();
    const ctxEmail = normalizeEmail(ctxUser?.email);

    const nameCandidates = [];
    const pushName = (value) => {
      const clean = String(value || "").trim();
      if (clean) nameCandidates.push(clean);
    };

    if (effectiveUid && ctxUid && effectiveUid === ctxUid) {
      pushName(ctxUser?.Name);
      pushName(ctxUser?.name);
      pushName(ctxUser?.displayName);
    }

    if (effectiveUid && sessionUid && effectiveUid === sessionUid) {
      pushName(sessionUser?.Name);
      pushName(sessionUser?.name);
      pushName(sessionUser?.displayName);
    }

    if (effectiveEmail && ctxEmail && effectiveEmail === ctxEmail) {
      pushName(ctxUser?.Name);
      pushName(ctxUser?.name);
      pushName(ctxUser?.displayName);
    }

    if (effectiveEmail && sessionEmail && effectiveEmail === sessionEmail) {
      pushName(sessionUser?.Name);
      pushName(sessionUser?.name);
      pushName(sessionUser?.displayName);
    }

    pushName(auth?.currentUser?.displayName);
    pushName(user.name);
    pushName(effectiveEmail);
    pushName("User");

    return {
      uid: effectiveUid,
      email: effectiveEmail,
      name: nameCandidates[0] || "User",
    };
  }, [
    ctxUser?.uid,
    ctxUser?.email,
    ctxUser?.Name,
    ctxUser?.name,
    ctxUser?.displayName,
    user.uid,
    user.email,
    user.name,
  ]);

  const isMobile = typeof window !== "undefined" && window.innerWidth <= 768;
  const shouldHide = HIDDEN_PATHS.has(location.pathname) || !me.uid;

  const [isOpen, setIsOpen] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [panelPosition, setPanelPosition] = useState(null);
  const [threadFilter, setThreadFilter] = useState("dm");
  const [threads, setThreads] = useState([]);
  const [activeThreadId, setActiveThreadId] = useState("");
  const [messages, setMessages] = useState([]);
  const [users, setUsers] = useState([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [showGroupModal, setShowGroupModal] = useState(false);
  const [showDmModal, setShowDmModal] = useState(false);
  const [dmSearch, setDmSearch] = useState("");
  const [groupMemberSearch, setGroupMemberSearch] = useState("");
  const [groupName, setGroupName] = useState("");
  const [groupMemberIds, setGroupMemberIds] = useState([]);
  const [groupCreating, setGroupCreating] = useState(false);
  const [messageText, setMessageText] = useState("");
  const [pendingFiles, setPendingFiles] = useState([]);
  const [sending, setSending] = useState(false);
  const [showThreadList, setShowThreadList] = useState(true);
  const [useRestChatFallback, setUseRestChatFallback] = useState(false);
  const [chatStatusHint, setChatStatusHint] = useState("");
  const [activeMessageMenuId, setActiveMessageMenuId] = useState("");
  const [showThreadMenu, setShowThreadMenu] = useState(false);
  const [showInfoModal, setShowInfoModal] = useState(false);
  const [infoMessage, setInfoMessage] = useState(null);
  const [showForwardModal, setShowForwardModal] = useState(false);
  const [forwardSearch, setForwardSearch] = useState("");
  const [forwardSelectedIds, setForwardSelectedIds] = useState([]);
  const [forwardQueue, setForwardQueue] = useState([]);
  const [forwarding, setForwarding] = useState(false);
  const [imagePreview, setImagePreview] = useState(null);
  const [showGroupManageModal, setShowGroupManageModal] = useState(false);
  const [showGroupInfoModal, setShowGroupInfoModal] = useState(false);
  const [groupNameDraft, setGroupNameDraft] = useState("");
  const [groupNameSaving, setGroupNameSaving] = useState(false);
  const [groupMuteSelection, setGroupMuteSelection] = useState([]);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedMessageIds, setSelectedMessageIds] = useState([]);
  const [showDeleteMessageModal, setShowDeleteMessageModal] = useState(false);
  const [deleteTargetMessage, setDeleteTargetMessage] = useState(null);
  const fileInputRef = useRef(null);
  const panelRef = useRef(null);
  const dragRef = useRef(null);
  const endRef = useRef(null);
  const messageMenuRef = useRef(null);
  const threadMenuRef = useRef(null);
  const notifiedMessageIdsRef = useRef(new Set());
  const restFallbackBlockedUntilRef = useRef(0);

  const isNativePlatform = useMemo(() => {
    try {
      return Capacitor.isNativePlatform();
    } catch {
      return false;
    }
  }, []);

  const myIdentity = useMemo(() => {
    const ids = new Set(
      [
        String(me?.uid || "").trim(),
        String(user?.uid || "").trim(),
      ].filter(Boolean)
    );

    const emails = new Set(
      [
        normalizeEmail(me?.email),
        normalizeEmail(user?.email),
      ].filter(Boolean)
    );

    return { ids, emails };
  }, [me?.uid, me?.email, user?.uid, user?.email]);

  const isThreadSentByMe = useCallback((thread) => {
    const senderId = String(thread?.lastMessageSenderId || "").trim();
    const senderEmail = normalizeEmail(thread?.lastMessageSenderEmail);
    if (senderId && myIdentity.ids.has(senderId)) return true;
    if (senderEmail && myIdentity.emails.has(senderEmail)) return true;
    return false;
  }, [myIdentity]);

  const isThreadUnreadForMe = useCallback((thread) => {
    const lastRead = thread?.lastReadAt?.[me.uid];
    return toMillis(thread?.lastMessageAt) > toMillis(lastRead) && !isThreadSentByMe(thread);
  }, [me.uid, isThreadSentByMe]);

  const userMap = useMemo(() => {
    const map = new Map();
    users.forEach((u) => map.set(u.uid, u));
    return map;
  }, [users]);

  const activeThread = useMemo(
    () => threads.find((t) => t.id === activeThreadId) || null,
    [threads, activeThreadId]
  );

  const getThreadTitle = useCallback((thread) => {
    if (!thread) return "";
    if (thread.type === "group") return String(thread.name || "Untitled Group").trim();

    const otherId = (thread.memberIds || []).find((id) => id !== me.uid) || "";
    const fromMembers = thread.memberMeta?.[otherId];
    const fromDirectory = userMap.get(otherId);
    return (
      fromMembers?.name ||
      fromDirectory?.name ||
      fromMembers?.email ||
      fromDirectory?.email ||
      "Direct Chat"
    );
  }, [me.uid, userMap]);

  const sortedThreads = useMemo(() => {
    const visible = [...threads].filter((t) => !(t?.deletedBy && t.deletedBy[me.uid]));
    const dmByKey = new Map();
    const nonDm = [];

    visible.forEach((thread) => {
      if (thread?.type === "group") {
        nonDm.push(thread);
        return;
      }

      const dmKey = getDmKeyForThread(thread, me.uid);
      if (!dmKey) {
        nonDm.push(thread);
        return;
      }

      const current = dmByKey.get(dmKey);
      if (!current || getThreadActivityMillis(thread) > getThreadActivityMillis(current)) {
        dmByKey.set(dmKey, thread);
      }
    });

    return [...nonDm, ...Array.from(dmByKey.values())]
      .sort(compareThreadsByActivity);
  }, [threads, me.uid]);

  const displayedThreads = useMemo(() => {
    if (threadFilter === "group") {
      return sortedThreads.filter((t) => t?.type === "group");
    }
    return sortedThreads.filter((t) => t?.type !== "group");
  }, [sortedThreads, threadFilter]);

  const isActiveGroup = activeThread?.type === "group";
  const isActiveGroupAdmin = Boolean(
    isActiveGroup && (
      activeThread?.createdBy === me.uid ||
      (Array.isArray(activeThread?.adminIds) && activeThread.adminIds.includes(me.uid))
    )
  );

  const activeGroupMutedMemberIds = useMemo(() => {
    if (!isActiveGroup) return [];
    return Array.isArray(activeThread?.mutedMemberIds)
      ? activeThread.mutedMemberIds.filter(Boolean)
      : [];
  }, [isActiveGroup, activeThread]);

  const isMeMutedInActiveGroup = Boolean(
    isActiveGroup && activeGroupMutedMemberIds.includes(me.uid) && !isActiveGroupAdmin
  );

  const groupMuteCandidates = useMemo(() => {
    if (!isActiveGroup) return [];
    const memberIds = Array.isArray(activeThread?.memberIds) ? activeThread.memberIds : [];
    return memberIds
      .filter((id) => id && id !== me.uid)
      .map((id) => {
        const info = activeThread?.memberMeta?.[id] || userMap.get(id) || {};
        return {
          uid: id,
          name: info?.name || info?.email || "User",
          email: info?.email || "",
        };
      });
  }, [isActiveGroup, activeThread, me.uid, userMap]);

  const activeGroupMembers = useMemo(() => {
    if (!isActiveGroup) return [];
    const memberIds = Array.isArray(activeThread?.memberIds) ? activeThread.memberIds : [];
    return memberIds.map((id) => {
      const meta = activeThread?.memberMeta?.[id] || userMap.get(id) || {};
      return {
        uid: id,
        name: meta?.name || meta?.email || "User",
        email: meta?.email || "",
        isAdmin: id === activeThread?.createdBy || (Array.isArray(activeThread?.adminIds) && activeThread.adminIds.includes(id)),
        isMuted: Array.isArray(activeThread?.mutedMemberIds) ? activeThread.mutedMemberIds.includes(id) : false,
      };
    });
  }, [isActiveGroup, activeThread, userMap]);

  const visibleMessages = useMemo(() => {
    return messages.filter((m) => !(m?.deletedFor && m.deletedFor[me.uid]));
  }, [messages, me.uid]);

  const unreadThreadCount = useMemo(() => {
    return sortedThreads.reduce((count, t) => {
      return isThreadUnreadForMe(t) ? count + 1 : count;
    }, 0);
  }, [sortedThreads, isThreadUnreadForMe]);

  const filteredDmUsers = useMemo(() => {
    const queryText = String(dmSearch || "").trim().toLowerCase();
    if (!queryText) return users;
    return users.filter((u) => {
      const hay = `${u.name || ""} ${u.email || ""}`.toLowerCase();
      return hay.includes(queryText);
    });
  }, [users, dmSearch]);

  const filteredGroupUsers = useMemo(() => {
    const queryText = String(groupMemberSearch || "").trim().toLowerCase();
    if (!queryText) return users;
    return users.filter((u) => {
      const hay = `${u.name || ""} ${u.email || ""}`.toLowerCase();
      return hay.includes(queryText);
    });
  }, [users, groupMemberSearch]);

  const forwardUsers = useMemo(() => {
    const queryText = String(forwardSearch || "").trim().toLowerCase();
    if (!queryText) return users;
    return users.filter((u) => {
      const hay = `${u.name || ""} ${u.email || ""}`.toLowerCase();
      return hay.includes(queryText);
    });
  }, [users, forwardSearch]);

  const selectedMessages = useMemo(() => {
    if (!selectedMessageIds.length) return [];
    const picked = new Set(selectedMessageIds);
    return visibleMessages.filter((m) => picked.has(m.id));
  }, [visibleMessages, selectedMessageIds]);

  const loadUsers = useCallback(async () => {
    if (!me.uid) return;
    setLoadingUsers(true);
    try {
      const rows = await fetchCollectionDocs("Users", 3500, 30000, 2000);
      const normalized = (rows || [])
        .map((r) => ({
          uid: String(r.id || r.uid || r.userId || "").trim(),
          email: String(r.email || r.Email || "").trim().toLowerCase(),
          name: String(r.Name || r.name || r.displayName || r.email || "").trim(),
          isActive: r.isActive !== false,
        }))
        .filter((r) => r.uid && r.uid !== me.uid && r.isActive)
        .sort((a, b) => String(a.name).localeCompare(String(b.name)));

      setUsers(normalized);
    } catch (err) {
      console.warn("Chat users fetch failed", err?.message || err);
      setUsers([]);
    } finally {
      setLoadingUsers(false);
    }
  }, [me.uid]);

  const getSessionToken = useCallback(async () => {
    let storedToken = "";
    try {
      const raw = localStorage.getItem("kp-user");
      if (raw) {
        const parsed = JSON.parse(raw);
        storedToken = String(parsed?.idToken || "").trim();
      }
    } catch {
      storedToken = "";
    }

    const authUid = String(auth?.currentUser?.uid || "").trim();
    const shouldUseFreshAuthToken = !!authUid && (!me.uid || authUid === me.uid);
    if (!shouldUseFreshAuthToken) return storedToken;

    try {
      const freshToken = await auth?.currentUser?.getIdToken?.();
      const token = String(freshToken || "").trim();
      if (!token) return storedToken;

      if (token !== storedToken) {
        try {
          const raw = localStorage.getItem("kp-user");
          const parsed = raw ? JSON.parse(raw) : {};
          parsed.idToken = token;
          localStorage.setItem("kp-user", JSON.stringify(parsed));
        } catch {
          // best effort
        }
      }
      return token;
    } catch {
      return storedToken;
    }
  }, [me.uid]);

  const fetchChatThreadsByRest = useCallback(async () => {
    const token = await getSessionToken();
    if (!token || !me.uid) return [];

    const projectId = app?.options?.projectId || "kapil-power-crm";
    const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents:runQuery`;

    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        structuredQuery: {
          from: [{ collectionId: "chatThreads" }],
          where: {
            fieldFilter: {
              field: { fieldPath: "memberIds" },
              op: "ARRAY_CONTAINS",
              value: { stringValue: me.uid },
            },
          },
          limit: 220,
        },
      }),
    });

    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`Chat threads query failed ${resp.status} ${text}`);
    }

    const rows = await resp.json();
    return (rows || [])
      .map((row) => {
        const docSnap = row?.document;
        if (!docSnap) return null;
        const id = String(docSnap.name || "").split("/").pop();
        return { id, ...fieldsToObject(docSnap.fields || {}) };
      })
      .filter(Boolean)
      .sort((a, b) => getThreadActivityMillis(b) - getThreadActivityMillis(a));
  }, [getSessionToken, me.uid]);

  const fetchChatMessagesByRest = useCallback(async (threadId) => {
    const token = await getSessionToken();
    if (!token || !threadId) return [];

    const projectId = app?.options?.projectId || "kapil-power-crm";
    const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/chatThreads/${encodeURIComponent(threadId)}:runQuery`;

    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        structuredQuery: {
          from: [{ collectionId: "messages" }],
          orderBy: [{ field: { fieldPath: "createdAt" }, direction: "ASCENDING" }],
          limit: 350,
        },
      }),
    });

    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`Chat messages query failed ${resp.status} ${text}`);
    }

    const rows = await resp.json();
    return (rows || [])
      .map((row) => {
        const docSnap = row?.document;
        if (!docSnap) return null;
        const id = String(docSnap.name || "").split("/").pop();
        return { id, ...fieldsToObject(docSnap.fields || {}) };
      })
      .filter(Boolean);
  }, [getSessionToken]);

  const getUserDisplayById = useCallback((uid) => {
    if (!uid) return "User";
    const fromDirectory = userMap.get(uid);
    if (fromDirectory?.name) return fromDirectory.name;
    if (fromDirectory?.email) return fromDirectory.email;

    const fromThread = threads.find((t) => (t.memberIds || []).includes(uid));
    const meta = fromThread?.memberMeta?.[uid];
    return meta?.name || meta?.email || "User";
  }, [threads, userMap]);

  const resolveSenderName = useCallback((threadId, senderUidValue, senderEmailValue) => {
    const senderUid = String(senderUidValue || "").trim();
    const senderEmail = normalizeEmail(senderEmailValue);
    const thread = threads.find((t) => t.id === threadId) || null;
    const fromThreadMeta = senderUid ? thread?.memberMeta?.[senderUid] : null;
    const fromDirectory = senderUid ? userMap.get(senderUid) : null;

    const sessionUser = getSessionUser();
    const sessionUid = String(
      sessionUser?.uid ||
      sessionUser?.id ||
      sessionUser?.profile?.uid ||
      ""
    ).trim();
    const sessionEmail = normalizeEmail(
      sessionUser?.email ||
      sessionUser?.Email ||
      sessionUser?.profile?.email
    );
    const ctxUid = String(ctxUser?.uid || "").trim();
    const ctxEmail = normalizeEmail(ctxUser?.email);

    const senderDisplayFromId = senderUid ? getUserDisplayById(senderUid) : "";
    const safeDisplayFromId = senderDisplayFromId === "User" ? "" : senderDisplayFromId;

    const candidates = [
      fromThreadMeta?.name,
      fromDirectory?.name,
      safeDisplayFromId,
      senderUid && senderUid === ctxUid ? (ctxUser?.Name || ctxUser?.name || ctxUser?.displayName) : "",
      senderUid && senderUid === me.uid ? me.name : "",
      senderUid && senderUid === user.uid ? user.name : "",
      senderUid && senderUid === sessionUid ? (sessionUser?.Name || sessionUser?.name || sessionUser?.displayName) : "",
      senderEmail && senderEmail === ctxEmail ? (ctxUser?.Name || ctxUser?.name || ctxUser?.displayName) : "",
      senderEmail && senderEmail === me.email ? me.name : "",
      senderEmail && senderEmail === user.email ? user.name : "",
      senderEmail && senderEmail === sessionEmail ? (sessionUser?.Name || sessionUser?.name || sessionUser?.displayName) : "",
      auth?.currentUser?.displayName,
      senderEmail,
      "User",
    ];

    return candidates
      .map((value) => String(value || "").trim())
      .find(Boolean) || "User";
  }, [
    threads,
    userMap,
    ctxUser?.uid,
    ctxUser?.email,
    ctxUser?.Name,
    ctxUser?.name,
    ctxUser?.displayName,
    me.uid,
    me.email,
    me.name,
    user.uid,
    user.email,
    user.name,
    getUserDisplayById,
  ]);

  const primeNotificationPermissions = useCallback(async () => {
    try {
      if (isNativePlatform) {
        const current = await LocalNotifications.checkPermissions();
        if (current?.display !== "granted") {
          await LocalNotifications.requestPermissions();
        }
        return;
      }

      if (typeof window !== "undefined" && "Notification" in window && Notification.permission === "default") {
        await Notification.requestPermission();
      }
    } catch {
      // best effort
    }
  }, [isNativePlatform]);

  const panelLayoutStyle = useMemo(() => {
    if (isMobile) return styles.panelMobile;
    if (isFullscreen) return styles.panelFullscreen;
    if (panelPosition && Number.isFinite(panelPosition.left) && Number.isFinite(panelPosition.top)) {
      return {
        ...styles.panelDesktopFloating,
        left: panelPosition.left,
        top: panelPosition.top,
      };
    }
    return styles.panelDesktop;
  }, [isMobile, isFullscreen, panelPosition]);

  const startPanelDrag = useCallback((event) => {
    if (isMobile || isFullscreen) return;
    if (event.button !== 0) return;
    if (event.target?.closest?.("button")) return;

    const rect = panelRef.current?.getBoundingClientRect();
    if (!rect) return;

    dragRef.current = {
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
      width: rect.width,
      height: rect.height,
    };
    setPanelPosition({ left: rect.left, top: rect.top });
    event.preventDefault();
  }, [isMobile, isFullscreen]);

  const toggleFullscreen = useCallback(() => {
    if (isMobile) return;
    if (!isFullscreen) {
      const rect = panelRef.current?.getBoundingClientRect();
      if (rect) {
        setPanelPosition({ left: rect.left, top: rect.top });
      }
    }
    setIsFullscreen((prev) => !prev);
  }, [isMobile, isFullscreen]);

  const notifyIncomingMessage = useCallback(async (thread) => {
    const text = String(thread?.lastMessageText || "New message").trim() || "New message";
    const senderId = String(thread?.lastMessageSenderId || "").trim();
    const senderById = senderId ? getUserDisplayById(senderId) : "";
    const safeSenderById = senderById === "User" ? "" : senderById;
    const senderName =
      safeSenderById ||
      String(thread?.lastMessageSenderName || "").trim() ||
      normalizeEmail(thread?.lastMessageSenderEmail) ||
      getUserDisplayById(senderId);
    const threadTitle = getThreadTitle(thread);

    const title = "Kapil Chat";
    const body = thread?.type === "group"
      ? `${senderName} in ${threadTitle}: ${text}`
      : `You got a message from ${senderName}: ${text}`;

    try {
      if (isNativePlatform) {
        const current = await LocalNotifications.checkPermissions();
        if (current?.display !== "granted") {
          const asked = await LocalNotifications.requestPermissions();
          if (asked?.display !== "granted") return;
        }
        await LocalNotifications.schedule({
          notifications: [
            {
              id: Date.now() % 2147483000,
              title,
              body,
              schedule: { at: new Date(Date.now() + 50) },
              extra: {
                kind: "chat_message",
                threadId: String(thread?.id || ""),
              },
            },
          ],
        });
        return;
      }

      if (typeof window !== "undefined" && "Notification" in window) {
        if (Notification.permission === "granted") {
          new Notification(title, { body });
        }
      }
    } catch {
      // best effort
    }
  }, [getThreadTitle, getUserDisplayById, isNativePlatform]);

  useEffect(() => {
    if (!user.uid || !me.uid) return;
    if (user.uid === me.uid) return;
    console.warn("Chat identity mismatch: session uid differs from Firebase auth uid", {
      sessionUid: user.uid,
      authUid: me.uid,
    });
    setChatStatusHint("Syncing account identity for chat...");
  }, [user.uid, me.uid]);

  useEffect(() => {
    if (!me.uid || shouldHide) {
      setThreads([]);
      setMessages([]);
      setActiveThreadId("");
      setChatStatusHint("");
      return undefined;
    }

    if (useRestChatFallback) {
      let alive = true;

      const pollThreads = async () => {
        try {
          const rows = await fetchChatThreadsByRest();
          if (!alive) return;
          const list = [...(rows || [])].sort(compareThreadsByActivity);
          setThreads(list);
          setChatStatusHint("");
          if (!activeThreadId && list.length > 0) {
            setActiveThreadId(list[0].id);
          }
        } catch (err) {
          console.warn("Chat threads REST poll failed", err?.message || err);
          const msg = String(err?.message || "").toLowerCase();
          if (msg.includes(" 403 ") || msg.includes('"code": 403')) {
            restFallbackBlockedUntilRef.current = Date.now() + 30000;
            setUseRestChatFallback(false);
            setChatStatusHint("Chat auth sync issue. Retrying automatically...");
            return;
          }

          if (msg.includes(" 400 ") || msg.includes('"code": 400') || msg.includes("requires an index")) {
            setUseRestChatFallback(false);
            setChatStatusHint("Refreshing chats...");
            return;
          }
        }
      };

      void pollThreads();
      const timer = setInterval(pollThreads, 5000);
      return () => {
        alive = false;
        clearInterval(timer);
      };
    }

    const q = query(collection(db, "chatThreads"), where("memberIds", "array-contains", me.uid));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const list = snap.docs
          .map((d) => ({ id: d.id, ...(d.data() || {}) }))
          .sort(compareThreadsByActivity);
        setThreads(list);
        if (!activeThreadId && list.length > 0) {
          setActiveThreadId(list[0].id);
        }
      },
      (err) => {
        console.warn("Chat threads listener failed", err?.message || err);
        setThreads([]);
        const code = String(err?.code || "").toLowerCase();
        const msg = String(err?.message || "").toLowerCase();
        const isAuthIssue =
          code.includes("permission") ||
          code.includes("unauth") ||
          msg.includes("permission") ||
          msg.includes("insufficient") ||
          msg.includes("unauth");
        const isTransientSdkIssue =
          code.includes("unavailable") ||
          code.includes("deadline") ||
          code.includes("aborted") ||
          msg.includes("timeout") ||
          msg.includes("network") ||
          msg.includes("unavailable");

        if (isAuthIssue || isTransientSdkIssue) {
          if (Date.now() >= restFallbackBlockedUntilRef.current) {
            setUseRestChatFallback(true);
            setChatStatusHint("Loading chats...");
          } else {
            setChatStatusHint("Chat temporarily unavailable. Please wait a few seconds.");
          }
        }
      }
    );

    return () => unsub();
  }, [me.uid, shouldHide, activeThreadId, useRestChatFallback, fetchChatThreadsByRest]);

  useEffect(() => {
    if (!activeThreadId || !me.uid || shouldHide) {
      setMessages([]);
      return undefined;
    }

    if (useRestChatFallback) {
      let alive = true;
      const pollMessages = async () => {
        try {
          const rows = await fetchChatMessagesByRest(activeThreadId);
          if (!alive) return;
          const list = (rows || []).sort((a, b) => toMillis(a.createdAt) - toMillis(b.createdAt));
          setMessages(list);
        } catch (err) {
          console.warn("Chat messages REST poll failed", err?.message || err);
        }
      };

      void pollMessages();
      const timer = setInterval(pollMessages, 3000);
      return () => {
        alive = false;
        clearInterval(timer);
      };
    }

    const q = query(
      collection(db, "chatThreads", activeThreadId, "messages"),
      orderBy("createdAt", "asc"),
      limit(300)
    );

    const unsub = onSnapshot(
      q,
      async (snap) => {
        const list = snap.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));
        setMessages(list);

        const unread = list.filter(
          (m) => m.senderId !== me.uid && !(m.readBy && m.readBy[me.uid])
        );

        if (unread.length) {
          const readStamp = new Date();
          const batch = writeBatch(db);
          unread.forEach((m) => {
            batch.update(doc(db, "chatThreads", activeThreadId, "messages", m.id), {
              [`readBy.${me.uid}`]: readStamp,
            });
          });
          batch.update(doc(db, "chatThreads", activeThreadId), {
            [`lastReadAt.${me.uid}`]: readStamp,
            updatedAt: serverTimestamp(),
          });
          try {
            await batch.commit();
          } catch (err) {
            console.warn("Chat read update failed", err?.message || err);
          }
        } else {
          try {
            const readStamp = new Date();
            await updateDoc(doc(db, "chatThreads", activeThreadId), {
              [`lastReadAt.${me.uid}`]: readStamp,
              updatedAt: serverTimestamp(),
            });
          } catch {
            // no-op
          }
        }
      },
      (err) => {
        console.warn("Chat messages listener failed", err?.message || err);
        setMessages([]);
        const code = String(err?.code || "").toLowerCase();
        const msg = String(err?.message || "").toLowerCase();
        const isSdkIssue =
          code.includes("permission") ||
          code.includes("unauth") ||
          code.includes("unavailable") ||
          code.includes("deadline") ||
          code.includes("aborted") ||
          msg.includes("permission") ||
          msg.includes("insufficient") ||
          msg.includes("unauth") ||
          msg.includes("timeout") ||
          msg.includes("network") ||
          msg.includes("unavailable");
        if (isSdkIssue && Date.now() >= restFallbackBlockedUntilRef.current) {
          setUseRestChatFallback(true);
          setChatStatusHint("Loading messages...");
        }
      }
    );

    return () => unsub();
  }, [activeThreadId, me.uid, shouldHide, useRestChatFallback, fetchChatMessagesByRest]);

  useEffect(() => {
    if (!isOpen || shouldHide) return;
    loadUsers();
  }, [isOpen, shouldHide, loadUsers]);

  useEffect(() => {
    const onPointerMove = (event) => {
      const drag = dragRef.current;
      if (!drag || isMobile || isFullscreen) return;

      const nextLeft = event.clientX - drag.offsetX;
      const nextTop = event.clientY - drag.offsetY;
      const maxLeft = Math.max(8, window.innerWidth - drag.width - 8);
      const maxTop = Math.max(8, window.innerHeight - drag.height - 8);

      setPanelPosition({
        left: Math.min(Math.max(8, nextLeft), maxLeft),
        top: Math.min(Math.max(8, nextTop), maxTop),
      });
    };

    const stopDragging = () => {
      dragRef.current = null;
    };

    if (typeof window !== "undefined") {
      window.addEventListener("pointermove", onPointerMove);
      window.addEventListener("pointerup", stopDragging);
      window.addEventListener("pointercancel", stopDragging);
    }

    return () => {
      if (typeof window !== "undefined") {
        window.removeEventListener("pointermove", onPointerMove);
        window.removeEventListener("pointerup", stopDragging);
        window.removeEventListener("pointercancel", stopDragging);
      }
    };
  }, [isMobile, isFullscreen]);

  useEffect(() => {
    if (isMobile || isFullscreen) return undefined;
    if (!panelPosition) return undefined;

    const clampPanelInView = () => {
      const rect = panelRef.current?.getBoundingClientRect();
      const width = rect?.width || 420;
      const height = rect?.height || 560;
      const maxLeft = Math.max(8, window.innerWidth - width - 8);
      const maxTop = Math.max(8, window.innerHeight - height - 8);
      setPanelPosition((prev) => {
        if (!prev) return prev;
        return {
          left: Math.min(Math.max(8, prev.left), maxLeft),
          top: Math.min(Math.max(8, prev.top), maxTop),
        };
      });
    };

    if (typeof window !== "undefined") {
      window.addEventListener("resize", clampPanelInView);
    }

    return () => {
      if (typeof window !== "undefined") {
        window.removeEventListener("resize", clampPanelInView);
      }
    };
  }, [panelPosition, isMobile, isFullscreen]);

  useEffect(() => {
    if (!me.uid || shouldHide) return;

    const activeDmKey = getDmKeyForThread(activeThread, me.uid);

    const incoming = sortedThreads.filter((t) => {
      const lastMessageId = String(t.lastMessageId || "").trim();
      if (!lastMessageId) return false;
      if (notifiedMessageIdsRef.current.has(lastMessageId)) return false;

      if (!isThreadUnreadForMe(t)) return false;

      const incomingDmKey = getDmKeyForThread(t, me.uid);
      const isSameVisibleDirectConversation =
        t?.type !== "group" &&
        !!activeDmKey &&
        !!incomingDmKey &&
        activeDmKey === incomingDmKey;

      const currentlyViewingThisThread =
        isOpen &&
        (activeThreadId === t.id || isSameVisibleDirectConversation) &&
        typeof document !== "undefined" &&
        document.visibilityState === "visible";

      if (currentlyViewingThisThread) return false;
      return true;
    });

    if (!incoming.length) return;

    incoming.forEach((t) => {
      const lastMessageId = String(t.lastMessageId || "").trim();
      if (!lastMessageId) return;
      notifiedMessageIdsRef.current.add(lastMessageId);
      void notifyIncomingMessage(t);
    });

    if (notifiedMessageIdsRef.current.size > 1200) {
      notifiedMessageIdsRef.current = new Set(Array.from(notifiedMessageIdsRef.current).slice(-400));
    }
  }, [
    sortedThreads,
    me.uid,
    shouldHide,
    isOpen,
    activeThreadId,
    activeThread,
    notifyIncomingMessage,
    isThreadUnreadForMe,
  ]);

  useEffect(() => {
    if (!isOpen) return;
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, isOpen]);

  useEffect(() => {
    setActiveMessageMenuId("");
    setShowThreadMenu(false);
    setShowGroupManageModal(false);
    setShowGroupInfoModal(false);
    setGroupNameDraft("");
    setGroupNameSaving(false);
    setGroupMuteSelection([]);
    setSelectionMode(false);
    setSelectedMessageIds([]);
    setShowInfoModal(false);
    setInfoMessage(null);
    setShowForwardModal(false);
    setForwardQueue([]);
    setForwardSelectedIds([]);
    setForwardSearch("");
    setImagePreview(null);
    setShowDeleteMessageModal(false);
    setDeleteTargetMessage(null);
  }, [activeThreadId]);

  useEffect(() => {
    if (!imagePreview?.url) return undefined;

    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        setImagePreview(null);
      }
    };

    if (typeof document !== "undefined") {
      document.addEventListener("keydown", onKeyDown);
    }

    return () => {
      if (typeof document !== "undefined") {
        document.removeEventListener("keydown", onKeyDown);
      }
    };
  }, [imagePreview]);

  useEffect(() => {
    if (!activeThread) return;
    if (activeThread.type === "group") {
      setThreadFilter("group");
      return;
    }
    setThreadFilter("dm");
  }, [activeThreadId, activeThread]);

  useEffect(() => {
    const onPointerDown = (event) => {
      if (activeMessageMenuId) {
        if (messageMenuRef.current && messageMenuRef.current.contains(event.target)) return;
        setActiveMessageMenuId("");
      }
      if (showThreadMenu) {
        if (threadMenuRef.current && threadMenuRef.current.contains(event.target)) return;
        setShowThreadMenu(false);
      }
    };
    if (typeof document !== "undefined") {
      document.addEventListener("mousedown", onPointerDown);
    }
    return () => {
      if (typeof document !== "undefined") {
        document.removeEventListener("mousedown", onPointerDown);
      }
    };
  }, [activeMessageMenuId, showThreadMenu]);

  const ensureDirectThread = useCallback(async (target, opts = {}) => {
    if (!target?.uid || !me.uid) return "";

    const pair = [me.uid, target.uid].sort();
    const dmKey = pair.join("_");
    const hasSameDmMembers = (thread) => {
      if (!thread || thread.type === "group") return false;
      const ids = Array.isArray(thread.memberIds) ? thread.memberIds.filter(Boolean).sort() : [];
      return ids.length === 2 && ids[0] === pair[0] && ids[1] === pair[1];
    };

    const existing = threads.find(
      (t) => (
        t?.type === "dm" &&
        !(t?.deletedBy && t.deletedBy[me.uid]) &&
        ((String(t?.dmKey || "").trim() === dmKey) || hasSameDmMembers(t))
      )
    );

    if (existing?.id) {
      if (!opts?.silent) {
        setActiveThreadId(existing.id);
        setDmSearch("");
        setShowDmModal(false);
        setShowThreadList(false);
      }
      return existing.id;
    }

    const revived = threads.find(
      (t) => t?.type === "dm" && ((String(t?.dmKey || "").trim() === dmKey) || hasSameDmMembers(t))
    );

    if (revived?.id) {
      if (useRestChatFallback) {
        const token = await getSessionToken();
        if (!token) throw new Error("No idToken available for chat fallback");
        await updateDocumentREST("chatThreads", revived.id, {
          dmKey,
          memberIds: pair,
          memberEmails: [me.email, target.email].filter(Boolean),
          memberMeta: {
            ...(revived.memberMeta || {}),
            [me.uid]: { uid: me.uid, name: me.name, email: me.email },
            [target.uid]: { uid: target.uid, name: target.name, email: target.email },
          },
          deletedBy: {
            ...(revived.deletedBy || {}),
            [me.uid]: null,
          },
          lastReadAt: {
            ...(revived.lastReadAt || {}),
            [me.uid]: new Date(),
          },
          updatedAt: new Date(),
        }, token);
      } else {
        await updateDoc(doc(db, "chatThreads", revived.id), {
          dmKey,
          memberIds: pair,
          memberEmails: [me.email, target.email].filter(Boolean),
          memberMeta: {
            ...(revived.memberMeta || {}),
            [me.uid]: { uid: me.uid, name: me.name, email: me.email },
            [target.uid]: { uid: target.uid, name: target.name, email: target.email },
          },
          [`deletedBy.${me.uid}`]: deleteField(),
          [`lastReadAt.${me.uid}`]: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }

      if (!opts?.silent) {
        setActiveThreadId(revived.id);
        setDmSearch("");
        setShowDmModal(false);
        setShowThreadList(false);
      }

      return revived.id;
    }

    const threadId = `dm_${pair[0]}_${pair[1]}`;
    const threadRef = doc(db, "chatThreads", threadId);

    const memberMeta = {
      [me.uid]: { uid: me.uid, name: me.name, email: me.email },
      [target.uid]: { uid: target.uid, name: target.name, email: target.email },
    };

    if (useRestChatFallback) {
      const token = await getSessionToken();
      const now = new Date();
      if (!token) throw new Error("No idToken available for chat fallback");
      const payload = {
        id: threadId,
        type: "dm",
        dmKey,
        memberIds: pair,
        memberEmails: [me.email, target.email].filter(Boolean),
        memberMeta,
        createdBy: me.uid,
        lastMessageText: "",
        lastMessageAt: null,
        lastMessageSenderId: "",
        lastMessageSenderEmail: "",
        lastReadAt: { [me.uid]: now },
        deletedBy: { [me.uid]: null },
        updatedAt: now,
        createdAt: now,
      };

      try {
        await createDocumentREST("chatThreads", payload, token, threadId);
      } catch (err) {
        const msg = String(err?.message || "").toLowerCase();
        if (!msg.includes("already") && !msg.includes("exists") && !msg.includes("409")) {
          throw err;
        }
        await updateDocumentREST("chatThreads", threadId, payload, token);
      }
    } else {
      await setDoc(
        threadRef,
        {
          id: threadId,
          type: "dm",
          dmKey,
          memberIds: pair,
          memberEmails: [me.email, target.email].filter(Boolean),
          memberMeta,
          createdBy: me.uid,
          lastMessageText: "",
          lastMessageAt: null,
          lastMessageSenderId: "",
          lastMessageSenderEmail: "",
          deletedBy: { [me.uid]: null },
          lastReadAt: { [me.uid]: serverTimestamp() },
          updatedAt: serverTimestamp(),
          createdAt: serverTimestamp(),
        },
        { merge: true }
      );
    }

    setThreads((prev) => {
      const optimistic = {
        id: threadId,
        type: "dm",
        dmKey,
        memberIds: pair,
        memberEmails: [me.email, target.email].filter(Boolean),
        memberMeta,
        createdBy: me.uid,
        lastMessageText: "",
        lastMessageAt: null,
        lastMessageSenderId: "",
        lastMessageSenderEmail: "",
        deletedBy: { [me.uid]: null },
        lastReadAt: { [me.uid]: new Date() },
        updatedAt: new Date(),
        createdAt: new Date(),
      };
      return [optimistic, ...prev.filter((t) => t.id !== threadId)];
    });

    if (useRestChatFallback) {
      try {
        const latest = await fetchChatThreadsByRest();
        setThreads(latest || []);
      } catch {
        // keep optimistic local thread if refresh fails
      }
    }

    if (!opts?.silent) {
      setActiveThreadId(threadId);
      setDmSearch("");
      setShowDmModal(false);
      setShowThreadList(false);
    }

    return threadId;
  }, [threads, me.uid, me.name, me.email, useRestChatFallback, getSessionToken, fetchChatThreadsByRest]);

  const createOrOpenDirectThread = async (target) => {
    try {
      await ensureDirectThread(target);
    } catch (err) {
      console.error("Direct chat open failed", err);
      alert("Unable to start direct chat right now. Please try again.");
    }
  };

  const createGroupThread = async () => {
    if (groupCreating) return;
    const cleanName = String(groupName || "").trim();
    const memberIds = Array.from(new Set([me.uid, ...groupMemberIds])).filter(Boolean);
    if (!cleanName) {
      alert("Please enter a group name.");
      return;
    }
    if (memberIds.length < 2) {
      alert("Please select at least one member.");
      return;
    }

    const memberMeta = {};
    memberIds.forEach((id) => {
      if (id === me.uid) {
        memberMeta[id] = { uid: me.uid, name: me.name, email: me.email };
      } else {
        const u = userMap.get(id);
        memberMeta[id] = { uid: id, name: u?.name || "User", email: u?.email || "" };
      }
    });

    const payload = {
      type: "group",
      name: cleanName,
      adminIds: [me.uid],
      mutedMemberIds: [],
      memberIds,
      memberEmails: memberIds
        .map((id) => (id === me.uid ? me.email : userMap.get(id)?.email || ""))
        .filter(Boolean),
      memberMeta,
      createdBy: me.uid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      lastMessageText: "",
      lastMessageAt: null,
      lastMessageSenderId: "",
      lastMessageSenderEmail: "",
      lastReadAt: { [me.uid]: serverTimestamp() },
    };

    setGroupCreating(true);
    try {
      if (useRestChatFallback) {
        const token = await getSessionToken();
        const now = new Date();
        if (!token) throw new Error("No idToken available for chat fallback");

        const restPayload = {
          ...payload,
          createdAt: now,
          updatedAt: now,
          lastMessageAt: null,
          lastReadAt: { [me.uid]: now },
        };

        const created = await createDocumentREST("chatThreads", restPayload, token);
        setActiveThreadId(created.id);
      } else {
        const created = await addDoc(collection(db, "chatThreads"), payload);
        setActiveThreadId(created.id);
      }
      setGroupName("");
      setGroupMemberIds([]);
      setGroupMemberSearch("");
      setShowGroupModal(false);
      setShowThreadList(false);
    } catch (err) {
      console.error("Group create failed", err);
      alert("Failed to create group. Please try again.");
    } finally {
      setGroupCreating(false);
    }
  };

  const uploadFiles = async (threadId) => {
    if (!pendingFiles.length) return [];

    const uploaded = [];
    for (let i = 0; i < pendingFiles.length; i += 1) {
      const file = pendingFiles[i];
      const filePath = `chatFiles/${threadId}/${Date.now()}_${i}_${safeName(file.name)}`;
      const ref = storageRef(storage, filePath);
      await uploadBytes(ref, file);
      const url = await getDownloadURL(ref);
      uploaded.push({
        url,
        name: file.name,
        type: file.type || "application/octet-stream",
        size: Number(file.size || 0),
        path: filePath,
      });
    }
    return uploaded;
  };

  const getMessageContentText = useCallback((msg) => {
    const text = String(msg?.text || "").trim();
    const fileParts = Array.isArray(msg?.attachments)
      ? msg.attachments.map((a) => a?.url || a?.name || "file").filter(Boolean)
      : [];
    return [text, ...fileParts].filter(Boolean).join("\n").trim();
  }, []);

  const shareText = useCallback(async (text, label = "message") => {
    const payload = String(text || "").trim();
    if (!payload) {
      alert(`No ${label} content to share.`);
      return;
    }
    try {
      if (typeof navigator !== "undefined" && navigator.share) {
        await navigator.share({ text: payload });
        return;
      }
    } catch {
      // share dismissed or unsupported path, fallback to copy
    }

    try {
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(payload);
        alert(`Copied ${label}. Paste and share anywhere ✨`);
        return;
      }
    } catch {
      // fallback below
    }

    alert("Share is not supported on this device right now.");
  }, []);

  const copyMessage = useCallback(async (msg) => {
    const text = getMessageContentText(msg);
    if (!text) {
      alert("Nothing to copy in this message.");
      return;
    }
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        alert("Copied.");
      } else {
        alert("Clipboard not available in this browser.");
      }
    } catch {
      alert("Copy failed. Please try again.");
    }
  }, [getMessageContentText]);

  const openInfoForMessage = useCallback((msg) => {
    setInfoMessage(msg || null);
    setShowInfoModal(true);
    setActiveMessageMenuId("");
  }, []);

  const openForwardModal = useCallback((items) => {
    const queue = (items || []).filter(Boolean);
    if (!queue.length) {
      alert("Select at least one message to forward.");
      return;
    }
    setForwardQueue(queue);
    setForwardSearch("");
    setForwardSelectedIds([]);
    setShowForwardModal(true);
    setActiveMessageMenuId("");
  }, []);

  const sendMessageToThread = useCallback(async (threadId, payload) => {
    const targetThreadId = String(threadId || "").trim();
    const text = String(payload?.text || "").trim();
    const attachments = Array.isArray(payload?.attachments) ? payload.attachments : [];
    if (!targetThreadId || (!text && attachments.length === 0)) return;

    const senderUid = String(me.uid || auth?.currentUser?.uid || "").trim();
    const senderEmail = normalizeEmail(me.email || auth?.currentUser?.email);
    const senderName = resolveSenderName(targetThreadId, senderUid, senderEmail);
    if (!senderUid) return;

    const forwarded = payload?.forwarded === true;
    const forwardedFrom = payload?.forwardedFrom || null;
    const preview = text || (attachments.length ? `📎 ${attachments.length} file${attachments.length > 1 ? "s" : ""}` : "");
    const previewText = forwarded ? `↪ Forwarded${preview ? `: ${preview}` : ""}` : preview;

    if (useRestChatFallback) {
      const token = await getSessionToken();
      const now = new Date();
      if (!token) throw new Error("No idToken available for chat fallback");

      const msgRef = await createDocumentREST(
        `chatThreads/${targetThreadId}/messages`,
        {
          text,
          attachments,
          senderId: senderUid,
          senderName,
          senderEmail,
          createdAt: now,
          readBy: { [senderUid]: now },
          ...(forwarded ? { forwarded: true, forwardedFrom } : {}),
        },
        token
      );

      await updateDocumentREST(
        "chatThreads",
        targetThreadId,
        {
          lastMessageText: previewText,
          lastMessageAt: now,
          lastMessageSenderId: senderUid,
          lastMessageSenderName: senderName,
          lastMessageSenderEmail: senderEmail,
          lastMessageId: msgRef.id,
          updatedAt: now,
          lastReadAt: { [senderUid]: now },
        },
        token
      );
      return;
    }

    const msgRef = await addDoc(collection(db, "chatThreads", targetThreadId, "messages"), {
      text,
      attachments,
      senderId: senderUid,
      senderName,
      senderEmail,
      createdAt: serverTimestamp(),
      readBy: { [senderUid]: serverTimestamp() },
      ...(forwarded ? { forwarded: true, forwardedFrom } : {}),
    });

    await updateDoc(doc(db, "chatThreads", targetThreadId), {
      lastMessageText: previewText,
      lastMessageAt: serverTimestamp(),
      lastMessageSenderId: senderUid,
      lastMessageSenderName: senderName,
      lastMessageSenderEmail: senderEmail,
      lastMessageId: msgRef.id,
      updatedAt: serverTimestamp(),
      [`lastReadAt.${senderUid}`]: serverTimestamp(),
    });
  }, [getSessionToken, me.uid, me.email, useRestChatFallback, resolveSenderName]);

  const sendMessage = async () => {
    const threadId = String(activeThreadId || "").trim();
    const text = String(messageText || "").trim();
    if (isMeMutedInActiveGroup) {
      alert("You are muted in this group. Only admin can unmute you.");
      return;
    }
    if (!threadId || (!text && pendingFiles.length === 0) || sending) return;

    setSending(true);
    try {
      const attachments = await uploadFiles(threadId);
      await sendMessageToThread(threadId, { text, attachments });

      if (useRestChatFallback) {
        try {
          const [latestThreads, latestMessages] = await Promise.all([
            fetchChatThreadsByRest(),
            fetchChatMessagesByRest(threadId),
          ]);
          setThreads(latestThreads || []);
          setMessages((latestMessages || []).sort((a, b) => toMillis(a.createdAt) - toMillis(b.createdAt)));
        } catch {
          // keep current UI if immediate refresh fails
        }
      }

      setMessageText("");
      setPendingFiles([]);
      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch (err) {
      console.error("Message send failed", err);
      alert("Failed to send message. Please try again.");
    } finally {
      setSending(false);
    }
  };

  const shareMessage = useCallback(async (msg) => {
    const text = getMessageContentText(msg);
    await shareText(text, "message");
  }, [getMessageContentText, shareText]);

  const shareSelectedMessages = useCallback(async () => {
    if (!selectedMessages.length) {
      alert("Select messages first.");
      return;
    }
    const combined = selectedMessages
      .map((m, idx) => `#${idx + 1}\n${getMessageContentText(m)}`.trim())
      .filter(Boolean)
      .join("\n\n");
    await shareText(combined, "messages");
  }, [selectedMessages, getMessageContentText, shareText]);

  const isMineMessage = useCallback((msg) => {
    const senderId = String(msg?.senderId || "").trim();
    const senderEmail = String(msg?.senderEmail || "").trim().toLowerCase();
    const myUid = String(me.uid || "").trim();
    const myEmail = String(me.email || "").trim().toLowerCase();
    if (senderId && myUid) return senderId === myUid;
    if (senderEmail && myEmail) return senderEmail === myEmail;
    return false;
  }, [me.uid, me.email]);

  const toggleMessageSelection = useCallback((messageId) => {
    if (!messageId) return;
    setSelectedMessageIds((prev) => (
      prev.includes(messageId)
        ? prev.filter((id) => id !== messageId)
        : [...prev, messageId]
    ));
  }, []);

  const forwardMessagesToSelectedUsers = useCallback(async () => {
    if (forwarding) return;
    const queue = [...(forwardQueue || [])].sort((a, b) => toMillis(a.createdAt) - toMillis(b.createdAt));
    if (!queue.length) {
      alert("No messages selected for forwarding.");
      return;
    }

    const targetUsers = users.filter((u) => forwardSelectedIds.includes(u.uid));
    if (!targetUsers.length) {
      alert("Select at least one user.");
      return;
    }

    setForwarding(true);
    try {
      for (let i = 0; i < targetUsers.length; i += 1) {
        const target = targetUsers[i];
        const threadId = await ensureDirectThread(target, { silent: true });
        if (!threadId) continue;

        for (let j = 0; j < queue.length; j += 1) {
          const original = queue[j];
          const text = String(original?.text || "").trim();
          const attachments = Array.isArray(original?.attachments)
            ? original.attachments.map((a) => ({ ...(a || {}) }))
            : [];

          await sendMessageToThread(threadId, {
            text,
            attachments,
            forwarded: true,
            forwardedFrom: {
              threadId: activeThreadId,
              messageId: original?.id || "",
              senderId: original?.senderId || "",
              senderName: original?.senderName || original?.senderEmail || "User",
            },
          });
        }
      }

      setShowForwardModal(false);
      setForwardQueue([]);
      setForwardSelectedIds([]);
      setForwardSearch("");
      setSelectionMode(false);
      setSelectedMessageIds([]);
      alert("Forwarded successfully.");
    } catch (err) {
      console.error("Forward failed", err);
      alert("Forward failed. Please try again.");
    } finally {
      setForwarding(false);
    }
  }, [
    forwarding,
    forwardQueue,
    users,
    forwardSelectedIds,
    ensureDirectThread,
    sendMessageToThread,
    activeThreadId,
  ]);

  const updateMessageForThread = useCallback(async (threadId, messageId, payload) => {
    if (!threadId || !messageId || !payload) return;
    if (useRestChatFallback) {
      const token = await getSessionToken();
      if (!token) throw new Error("No idToken available for chat fallback");
      await updateDocumentREST(`chatThreads/${threadId}/messages`, messageId, payload, token);
      return;
    }
    await updateDoc(doc(db, "chatThreads", threadId, "messages", messageId), payload);
  }, [useRestChatFallback, getSessionToken]);

  const updateThreadDoc = useCallback(async (threadId, payload) => {
    if (!threadId || !payload) return;
    if (useRestChatFallback) {
      const token = await getSessionToken();
      if (!token) throw new Error("No idToken available for chat fallback");
      await updateDocumentREST("chatThreads", threadId, payload, token);
      return;
    }
    await updateDoc(doc(db, "chatThreads", threadId), payload);
  }, [useRestChatFallback, getSessionToken]);

  const saveGroupMuteSelection = useCallback(async (nextMutedIds = []) => {
    if (!isActiveGroup || !isActiveGroupAdmin) return;
    const threadId = String(activeThreadId || "").trim();
    if (!threadId) return;

    const validMemberIds = new Set(Array.isArray(activeThread?.memberIds) ? activeThread.memberIds : []);
    const filtered = Array.from(new Set(nextMutedIds))
      .filter((id) => id && id !== me.uid && validMemberIds.has(id));

    await updateThreadDoc(threadId, {
      mutedMemberIds: filtered,
      updatedAt: useRestChatFallback ? new Date() : serverTimestamp(),
    });
    setGroupMuteSelection(filtered);
  }, [
    isActiveGroup,
    isActiveGroupAdmin,
    activeThreadId,
    activeThread,
    me.uid,
    updateThreadDoc,
    useRestChatFallback,
  ]);

  const openGroupManageModal = useCallback(() => {
    if (!isActiveGroup || !isActiveGroupAdmin) return;
    setGroupMuteSelection(activeGroupMutedMemberIds);
    setShowGroupManageModal(true);
    setShowThreadMenu(false);
  }, [isActiveGroup, isActiveGroupAdmin, activeGroupMutedMemberIds]);

  const openGroupInfoModal = useCallback(() => {
    if (!isActiveGroup) return;
    setGroupNameDraft(String(activeThread?.name || "").trim());
    setShowThreadMenu(false);
    setShowGroupInfoModal(true);
  }, [isActiveGroup, activeThread]);

  const saveGroupName = useCallback(async () => {
    if (!isActiveGroup || !isActiveGroupAdmin || groupNameSaving) return;
    const cleanName = String(groupNameDraft || "").trim();
    if (!cleanName) {
      alert("Group name cannot be empty.");
      return;
    }
    if (cleanName === String(activeThread?.name || "").trim()) {
      setShowGroupInfoModal(false);
      return;
    }

    setGroupNameSaving(true);
    try {
      await updateThreadDoc(String(activeThreadId || "").trim(), {
        name: cleanName,
        updatedAt: useRestChatFallback ? new Date() : serverTimestamp(),
      });
      setShowGroupInfoModal(false);
      alert("Group name updated.");
    } catch (err) {
      console.error("Group rename failed", err);
      alert("Unable to update group name right now.");
    } finally {
      setGroupNameSaving(false);
    }
  }, [
    isActiveGroup,
    isActiveGroupAdmin,
    groupNameSaving,
    groupNameDraft,
    activeThread,
    updateThreadDoc,
    activeThreadId,
    useRestChatFallback,
  ]);

  const muteAllGroupMembers = useCallback(async () => {
    if (!isActiveGroup || !isActiveGroupAdmin) return;
    const muteAll = groupMuteCandidates.map((m) => m.uid);
    try {
      await saveGroupMuteSelection(muteAll);
      alert("All members are muted.");
    } catch (err) {
      console.error("Mute all failed", err);
      alert("Unable to mute all members right now.");
    }
  }, [isActiveGroup, isActiveGroupAdmin, groupMuteCandidates, saveGroupMuteSelection]);

  const unmuteAllGroupMembers = useCallback(async () => {
    if (!isActiveGroup || !isActiveGroupAdmin) return;
    try {
      await saveGroupMuteSelection([]);
      alert("All members are unmuted.");
    } catch (err) {
      console.error("Unmute all failed", err);
      alert("Unable to unmute all members right now.");
    }
  }, [isActiveGroup, isActiveGroupAdmin, saveGroupMuteSelection]);

  const exitActiveGroup = useCallback(async () => {
    if (!isActiveGroup || !activeThreadId) return;
    if (isActiveGroupAdmin) {
      alert("Group admin cannot exit directly. Use Delete group to close it for all members.");
      return;
    }
    const confirmed = window.confirm("Exit this group?");
    if (!confirmed) return;

    try {
      const currentMemberIds = Array.isArray(activeThread?.memberIds) ? activeThread.memberIds : [];
      const nextMemberIds = currentMemberIds.filter((id) => id !== me.uid);
      const nextMemberMeta = { ...(activeThread?.memberMeta || {}) };
      delete nextMemberMeta[me.uid];

      const stamp = useRestChatFallback ? new Date() : serverTimestamp();
      const deletedBy = {
        ...(activeThread?.deletedBy || {}),
        [me.uid]: stamp,
      };

      await updateThreadDoc(activeThreadId, {
        memberIds: nextMemberIds,
        memberMeta: nextMemberMeta,
        mutedMemberIds: activeGroupMutedMemberIds.filter((id) => id !== me.uid),
        deletedBy,
        updatedAt: stamp,
      });

      setActiveThreadId("");
      setShowThreadList(true);
      setShowThreadMenu(false);
      alert("You exited the group.");
    } catch (err) {
      console.error("Exit group failed", err);
      alert("Unable to exit this group right now.");
    }
  }, [
    isActiveGroup,
    activeThreadId,
    isActiveGroupAdmin,
    activeThread,
    me.uid,
    useRestChatFallback,
    updateThreadDoc,
    activeGroupMutedMemberIds,
  ]);

  const deleteGroupForAllMembers = useCallback(async () => {
    if (!isActiveGroup || !activeThreadId || !isActiveGroupAdmin) return;

    const confirmed = window.confirm(
      "Delete this group for everyone? This will remove all members and hide this group for all users."
    );
    if (!confirmed) return;

    try {
      const memberIds = Array.isArray(activeThread?.memberIds) ? activeThread.memberIds : [];
      const stamp = useRestChatFallback ? new Date() : serverTimestamp();
      const deletedBy = { ...(activeThread?.deletedBy || {}) };
      memberIds.forEach((id) => {
        if (id) deletedBy[id] = stamp;
      });

      await updateThreadDoc(activeThreadId, {
        deletedBy,
        memberIds: [],
        mutedMemberIds: [],
        isDeleted: true,
        deletedAt: stamp,
        deletedByAdmin: me.uid,
        lastMessageText: "Group was deleted by admin",
        updatedAt: stamp,
      });

      setActiveThreadId("");
      setShowThreadList(true);
      setShowThreadMenu(false);
      setShowGroupManageModal(false);
      alert("Group deleted for all members.");
    } catch (err) {
      console.error("Delete group failed", err);
      alert("Unable to delete group right now.");
    }
  }, [isActiveGroup, activeThreadId, isActiveGroupAdmin, activeThread, useRestChatFallback, updateThreadDoc, me.uid]);

  const clearActiveChat = useCallback(async () => {
    const threadId = String(activeThreadId || "").trim();
    if (!threadId) return;
    const confirmed = window.confirm("Clear chat? All messages and images will be removed from your view.");
    if (!confirmed) return;

    try {
      const ops = visibleMessages.map((m) => (
        updateMessageForThread(threadId, m.id, {
          [`deletedFor.${me.uid}`]: useRestChatFallback ? new Date() : serverTimestamp(),
        })
      ));
      await Promise.all(ops);
      setSelectedMessageIds([]);
      setSelectionMode(false);
      setShowThreadMenu(false);
      alert("Chat cleared for you.");
    } catch (err) {
      console.error("Clear chat failed", err);
      alert("Unable to clear chat right now.");
    }
  }, [activeThreadId, visibleMessages, updateMessageForThread, me.uid, useRestChatFallback]);

  const deleteActiveChat = useCallback(async () => {
    const threadId = String(activeThreadId || "").trim();
    if (!threadId) return;

    if (activeThread?.type === "group") {
      if (isActiveGroupAdmin) {
        await deleteGroupForAllMembers();
      } else {
        await exitActiveGroup();
      }
      return;
    }

    const confirmed = window.confirm(
      "Delete this chat from your list? This removes it for you and starting again with this user opens a fresh chat."
    );
    if (!confirmed) return;

    try {
      const stamp = useRestChatFallback ? new Date() : serverTimestamp();
      if (useRestChatFallback) {
        const token = await getSessionToken();
        if (!token) throw new Error("No idToken available for chat fallback");
        await updateDocumentREST("chatThreads", threadId, { deletedBy: { [me.uid]: new Date() } }, token);
      } else {
        await updateDoc(doc(db, "chatThreads", threadId), {
          [`deletedBy.${me.uid}`]: stamp,
          [`lastReadAt.${me.uid}`]: stamp,
          updatedAt: stamp,
        });
      }

      const ops = visibleMessages.map((m) => (
        updateMessageForThread(threadId, m.id, {
          [`deletedFor.${me.uid}`]: useRestChatFallback ? new Date() : serverTimestamp(),
        })
      ));
      await Promise.all(ops);

      setActiveThreadId("");
      setShowThreadList(true);
      setShowThreadMenu(false);
      setSelectionMode(false);
      setSelectedMessageIds([]);
      alert("Chat deleted for you.");
    } catch (err) {
      console.error("Delete chat failed", err);
      alert("Unable to delete chat right now.");
    }
  }, [
    activeThreadId,
    activeThread,
    isActiveGroupAdmin,
    deleteGroupForAllMembers,
    exitActiveGroup,
    useRestChatFallback,
    getSessionToken,
    me.uid,
    visibleMessages,
    updateMessageForThread,
  ]);

  const openDeleteMessageModal = useCallback((message) => {
    setDeleteTargetMessage(message || null);
    setShowDeleteMessageModal(true);
    setActiveMessageMenuId("");
  }, []);

  const removeMessageForMe = useCallback(async (message) => {
    const threadId = String(activeThreadId || "").trim();
    if (!message?.id || !threadId) return;

    await updateMessageForThread(threadId, message.id, {
      [`deletedFor.${me.uid}`]: useRestChatFallback ? new Date() : serverTimestamp(),
    });
  }, [activeThreadId, me.uid, updateMessageForThread, useRestChatFallback]);

  const deleteMessageWithMode = useCallback(async (mode) => {
    const message = deleteTargetMessage;
    const threadId = String(activeThreadId || "").trim();
    if (!message?.id || !threadId) return;

    try {
      if (mode === "me") {
        await removeMessageForMe(message);
      }

      if (mode === "everyone") {
        await updateMessageForThread(threadId, message.id, {
          text: "",
          attachments: [],
          deletedForEveryone: true,
          deletedAt: useRestChatFallback ? new Date() : serverTimestamp(),
          deletedBy: me.uid,
        });

        if (activeThread?.lastMessageId === message.id) {
          if (useRestChatFallback) {
            const token = await getSessionToken();
            if (!token) throw new Error("No idToken available for chat fallback");
            await updateDocumentREST("chatThreads", threadId, {
              lastMessageText: "This message was deleted",
              updatedAt: new Date(),
            }, token);
          } else {
            await updateDoc(doc(db, "chatThreads", threadId), {
              lastMessageText: "This message was deleted",
              updatedAt: serverTimestamp(),
            });
          }
        }
      }

      setShowDeleteMessageModal(false);
      setDeleteTargetMessage(null);
      setSelectedMessageIds((prev) => prev.filter((id) => id !== message.id));
    } catch (err) {
      console.error("Message delete failed", err);
      alert("Unable to delete message right now.");
    }
  }, [
    deleteTargetMessage,
    activeThreadId,
    removeMessageForMe,
    updateMessageForThread,
    activeThread,
    getSessionToken,
    me.uid,
    useRestChatFallback,
  ]);

  const onFilePick = (event) => {
    const files = Array.from(event.target?.files || []);
    if (!files.length) return;
    setPendingFiles((prev) => [...prev, ...files].slice(0, 8));
  };

  const onComposerPaste = useCallback((event) => {
    const items = Array.from(event.clipboardData?.items || []);
    if (!items.length) return;

    const imageFiles = items
      .filter((item) => item.kind === "file" && String(item.type || "").startsWith("image/"))
      .map((item, idx) => {
        const file = item.getAsFile();
        if (!file) return null;
        if (file.name) return file;
        const ext = String(file.type || "image/png").split("/")[1] || "png";
        return new File([file], `pasted-image-${Date.now()}-${idx}.${ext}`, {
          type: file.type || "image/png",
        });
      })
      .filter(Boolean);

    if (!imageFiles.length) return;
    event.preventDefault();
    setPendingFiles((prev) => [...prev, ...imageFiles].slice(0, 8));
  }, []);

  const pendingFilePreviews = useMemo(() => {
    return pendingFiles.map((file, idx) => {
      const isImage = String(file?.type || "").startsWith("image/");
      return {
        key: `${file?.name || "file"}_${file?.size || 0}_${idx}`,
        file,
        isImage,
        previewUrl: isImage ? URL.createObjectURL(file) : "",
      };
    });
  }, [pendingFiles]);

  useEffect(() => {
    return () => {
      pendingFilePreviews.forEach((item) => {
        if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
      });
    };
  }, [pendingFilePreviews]);

  if (shouldHide) return null;

  return (
    <>
      <div style={styles.bottomBarWrap}>
        <div style={styles.bottomBarLeft}>
          <div style={styles.brandLine}>Kapil Power & Infra Pvt Ltd</div>
          <div style={styles.contactLine}>
            <span style={styles.contactChip}><FiPhone size={13} /> +91-9247507145</span>
            <span style={styles.contactChip}><FiMail size={13} /> nareshk@kapilpower.com</span>
          </div>
        </div>

        <button
          type="button"
          onClick={() => {
            void primeNotificationPermissions();
            setIsOpen((v) => !v);
          }}
          style={styles.chatButton}
          title={isOpen ? "Close Kapil Chat" : "Open Kapil Chat"}
        >
          {isOpen ? <FiX size={20} /> : <FiMessageCircle size={20} />}
          {unreadThreadCount > 0 && (
            <span style={styles.chatBadge}>
              {unreadThreadCount > 99 ? "99+" : unreadThreadCount}
            </span>
          )}
        </button>
      </div>

      {isOpen && (
        <div
          ref={panelRef}
          style={{
            ...styles.panel,
            ...panelLayoutStyle,
          }}
        >
          <div
            style={{
              ...styles.panelHeader,
              ...(!isMobile && !isFullscreen ? styles.panelHeaderDraggable : null),
            }}
            onPointerDown={startPanelDrag}
          >
            <div>
              <div style={styles.panelTitle}>Kapil Chat</div>
              <div style={styles.panelSub}>Internal chat • files • seen info</div>
            </div>
            <div style={styles.panelHeaderActions}>
              {!isMobile && (
                <button
                  type="button"
                  onClick={toggleFullscreen}
                  style={styles.closeBtn}
                  title={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
                >
                  {isFullscreen ? <FiMinimize2 size={16} /> : <FiMaximize2 size={16} />}
                </button>
              )}
              <button type="button" onClick={() => setIsOpen(false)} style={styles.closeBtn} title="Close">
                <FiX size={18} />
              </button>
            </div>
          </div>

          <div style={styles.panelBody}>
            {(!isMobile || showThreadList) && (
              <div style={{ ...styles.threadColumn, ...(isMobile ? styles.threadColumnMobile : null) }}>
                <div style={styles.threadTools}>
                  <div style={styles.threadTabs}>
                    <div style={styles.threadTabCell}>
                      <button
                        type="button"
                        style={{ ...styles.toolBtn, ...(threadFilter === "dm" ? styles.toolBtnActive : null) }}
                        onClick={() => setThreadFilter("dm")}
                      >
                        Chat
                      </button>
                      {threadFilter === "dm" && (
                        <button
                          type="button"
                          style={styles.tabAddBtn}
                          onClick={() => {
                            setDmSearch("");
                            setShowDmModal(true);
                          }}
                          title="New direct chat"
                          aria-label="New direct chat"
                        >
                          <FiPlus size={13} />
                        </button>
                      )}
                    </div>

                    <div style={styles.threadTabCell}>
                      <button
                        type="button"
                        style={{ ...styles.toolBtn, ...(threadFilter === "group" ? styles.toolBtnActive : null) }}
                        onClick={() => setThreadFilter("group")}
                      >
                        Group
                      </button>
                      {threadFilter === "group" && (
                        <button
                          type="button"
                          style={styles.tabAddBtn}
                          onClick={() => {
                            setGroupMemberSearch("");
                            setShowGroupModal(true);
                          }}
                          title="New group"
                          aria-label="New group"
                        >
                          <FiPlus size={13} />
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                <div style={styles.threadList}>
                  {displayedThreads.length === 0 ? (
                    <div style={styles.emptyHint}>
                      {threadFilter === "group"
                        ? "No groups yet. Create one 👥"
                        : "No direct chats yet. Start one 👋"}
                    </div>
                  ) : (
                    displayedThreads.map((t) => {
                      const selected = t.id === activeThreadId;
                      const unread = isThreadUnreadForMe(t);
                      return (
                        <button
                          key={t.id}
                          type="button"
                          onClick={() => {
                            setActiveThreadId(t.id);
                            setShowThreadList(false);
                          }}
                          style={{
                            ...styles.threadItem,
                            ...(selected ? styles.threadItemActive : null),
                          }}
                        >
                          <div style={styles.threadTitleRow}>
                            <span style={styles.threadTitle}>{getThreadTitle(t)}</span>
                            <span style={styles.threadTime}>{formatDateLabel(getThreadActivityValue(t))}</span>
                          </div>
                          <div style={styles.threadPreviewRow}>
                            <span style={styles.threadPreview}>{t.lastMessageText || "No messages yet"}</span>
                            {unread && <span style={styles.unreadDot} />}
                          </div>
                        </button>
                      );
                    })
                  )}
                </div>
              </div>
            )}

            <div style={{ ...styles.chatColumn, ...(isMobile && showThreadList ? styles.chatColumnHidden : null) }}>
              <div style={styles.chatTopBar}>
                {isMobile && (
                  <button
                    type="button"
                    style={styles.backBtn}
                    onClick={() => setShowThreadList(true)}
                    title="Back to chats"
                  >
                    ←
                  </button>
                )}
                <div style={{ minWidth: 0 }}>
                  {activeThread?.type === "group" ? (
                    <button
                      type="button"
                      style={styles.activeThreadInfoBtn}
                      onClick={openGroupInfoModal}
                      title="View group members"
                    >
                      <div style={styles.activeTitle}>{getThreadTitle(activeThread)}</div>
                      <div style={styles.activeSub}>
                        {(activeThread.memberIds || []).length} members
                        {isMeMutedInActiveGroup ? " • You are muted" : ""}
                      </div>
                    </button>
                  ) : (
                    <>
                      <div style={styles.activeTitle}>{getThreadTitle(activeThread)}</div>
                      <div style={styles.activeSub}>Direct message</div>
                    </>
                  )}
                </div>
                {!!activeThread && (
                  <div style={styles.threadMenuWrap} ref={threadMenuRef}>
                    <button
                      type="button"
                      style={styles.threadMenuBtn}
                      onClick={() => setShowThreadMenu((prev) => !prev)}
                      title="Chat options"
                    >
                      <FiMoreVertical size={15} />
                    </button>

                    {showThreadMenu && (
                      <div style={styles.threadMenuPanel}>
                        {activeThread?.type !== "group" ? (
                          <>
                            <button type="button" style={styles.threadMenuItem} onClick={clearActiveChat}>
                              Clear chat
                            </button>
                            <button type="button" style={{ ...styles.threadMenuItem, ...styles.threadMenuItemDanger }} onClick={deleteActiveChat}>
                              Delete chat
                            </button>
                          </>
                        ) : (
                          <>
                            {isActiveGroupAdmin && (
                              <button type="button" style={styles.threadMenuItem} onClick={openGroupManageModal}>
                                Manage mute
                              </button>
                            )}
                            {!isActiveGroupAdmin && (
                              <button type="button" style={styles.threadMenuItem} onClick={exitActiveGroup}>
                                Exit group
                              </button>
                            )}
                            {isActiveGroupAdmin && (
                              <>
                                <button type="button" style={styles.threadMenuItem} onClick={muteAllGroupMembers}>
                                  Mute all members
                                </button>
                                <button type="button" style={styles.threadMenuItem} onClick={unmuteAllGroupMembers}>
                                  Unmute all members
                                </button>
                                <button type="button" style={{ ...styles.threadMenuItem, ...styles.threadMenuItemDanger }} onClick={deleteGroupForAllMembers}>
                                  Delete group
                                </button>
                              </>
                            )}
                          </>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {!!activeThread && (
                  <button
                    type="button"
                    style={styles.selectBtn}
                    onClick={() => {
                      setSelectionMode((prev) => {
                        const next = !prev;
                        if (!next) setSelectedMessageIds([]);
                        return next;
                      });
                      setActiveMessageMenuId("");
                    }}
                    title={selectionMode ? "Cancel selection" : "Select messages"}
                  >
                    {selectionMode ? <FiCheckSquare size={14} /> : <FiSquare size={14} />} Select
                  </button>
                )}
              </div>

              <div style={styles.msgList}>
                {!!chatStatusHint && (
                  <div style={styles.chatStatusHint}>{chatStatusHint}</div>
                )}

                {selectionMode && (
                  <div style={styles.selectionBar}>
                    <span>{selectedMessageIds.length} selected</span>
                    <div style={styles.selectionActions}>
                      <button
                        type="button"
                        style={styles.selectionBtn}
                        onClick={() => openForwardModal(selectedMessages)}
                        disabled={selectedMessageIds.length === 0}
                      >
                        <FiCornerUpRight size={13} /> Forward
                      </button>
                      <button
                        type="button"
                        style={styles.selectionBtn}
                        onClick={shareSelectedMessages}
                        disabled={selectedMessageIds.length === 0}
                      >
                        <FiShare2 size={13} /> Share
                      </button>
                      <button
                        type="button"
                        style={styles.selectionBtn}
                        onClick={() => {
                          setSelectionMode(false);
                          setSelectedMessageIds([]);
                        }}
                      >
                        <FiX size={13} /> Cancel
                      </button>
                    </div>
                  </div>
                )}
                {!activeThread ? (
                  <div style={styles.emptyCenter}>Select a chat to start messaging.</div>
                ) : visibleMessages.length === 0 ? (
                  <div style={styles.emptyCenter}>No messages yet. Say hello 👋</div>
                ) : (
                  visibleMessages.map((m) => {
                    const mine = isMineMessage(m);
                    const isSelected = selectedMessageIds.includes(m.id);
                    const deletedForEveryone = m.deletedForEveryone === true;
                    const readBy = m.readBy || {};
                    const readUsers = Object.entries(readBy)
                      .filter(([id]) => id !== me.uid)
                      .map(([id, ts]) => ({
                        id,
                        ts,
                        name: userMap.get(id)?.name || activeThread?.memberMeta?.[id]?.name || "User",
                      }));

                    const dmOtherId = (activeThread?.memberIds || []).find((id) => id !== me.uid) || "";
                    const dmSeenAtByThread = dmOtherId ? activeThread?.lastReadAt?.[dmOtherId] : null;
                    const dmSeen = !!dmOtherId && toMillis(dmSeenAtByThread) >= toMillis(m.createdAt);
                    const menuOpen = activeMessageMenuId === m.id;
                    const showInlineMeta = !deletedForEveryone && Boolean(String(m.text || "").trim());

                    return (
                      <div key={m.id} style={{ ...styles.msgBubbleWrap, ...(mine ? styles.msgBubbleWrapMine : null) }}>
                        <div
                          style={{
                            ...styles.msgBubbleCard,
                            ...(mine ? styles.msgBubbleCardMine : styles.msgBubbleCardOther),
                            ...(selectionMode ? styles.msgBubbleCardSelectable : null),
                            ...(isSelected ? styles.msgBubbleCardSelected : null),
                          }}
                        >
                          {selectionMode && (
                            <button
                              type="button"
                              style={{
                                ...styles.msgSelectToggle,
                                ...(isSelected ? styles.msgSelectToggleOn : null),
                              }}
                              onClick={() => toggleMessageSelection(m.id)}
                              title={isSelected ? "Deselect" : "Select"}
                            >
                              {isSelected ? <FiCheckSquare size={14} /> : <FiSquare size={14} />}
                            </button>
                          )}

                          <div style={{ ...styles.msgBubble, ...(mine ? styles.msgBubbleMine : styles.msgBubbleOther) }}>
                            <div style={styles.msgTopRow}>
                              {!mine && <div style={styles.msgSender}>{m.senderName || m.senderEmail || "User"}</div>}
                            </div>

                            <div style={styles.msgActionsWrap} ref={menuOpen ? messageMenuRef : null}>
                              <button
                                type="button"
                                style={styles.msgActionBtn}
                                onClick={() => setActiveMessageMenuId((prev) => (prev === m.id ? "" : m.id))}
                                title="Message options"
                              >
                                <FiMoreVertical size={14} />
                              </button>

                              {menuOpen && (
                                <div
                                  style={{
                                    ...styles.msgMenu,
                                    ...(mine ? styles.msgMenuRight : styles.msgMenuLeft),
                                  }}
                                >
                                  <button type="button" style={styles.msgMenuBtn} onClick={() => copyMessage(m)}>
                                    <FiCopy size={13} /> Copy
                                  </button>
                                  <button type="button" style={styles.msgMenuBtn} onClick={() => openForwardModal([m])}>
                                    <FiCornerUpRight size={13} /> Forward
                                  </button>
                                  <button type="button" style={styles.msgMenuBtn} onClick={() => shareMessage(m)}>
                                    <FiShare2 size={13} /> Share
                                  </button>
                                  <button type="button" style={styles.msgMenuBtn} onClick={() => openInfoForMessage(m)}>
                                    <FiInfo size={13} /> Info
                                  </button>
                                  <button type="button" style={{ ...styles.msgMenuBtn, ...styles.msgMenuBtnDanger }} onClick={() => openDeleteMessageModal(m)}>
                                    Delete
                                  </button>
                                  {!selectionMode && (
                                    <button
                                      type="button"
                                      style={styles.msgMenuBtn}
                                      onClick={() => {
                                        setSelectionMode(true);
                                        setSelectedMessageIds((prev) => (prev.includes(m.id) ? prev : [...prev, m.id]));
                                        setActiveMessageMenuId("");
                                      }}
                                    >
                                      <FiCheckSquare size={13} /> Select
                                    </button>
                                  )}
                                </div>
                              )}
                            </div>

                            {m.forwarded && (
                              <div style={styles.forwardedTag}>Forwarded</div>
                            )}

                            {deletedForEveryone ? (
                              <div style={styles.deletedMsgRow}>
                                <div style={styles.deletedMsgText}>This message was deleted</div>
                                <button
                                  type="button"
                                  style={styles.deletedMsgRemoveBtn}
                                  onClick={() => {
                                    removeMessageForMe(m).catch((err) => {
                                      console.error("Delete placeholder for me failed", err);
                                      alert("Unable to delete this message right now.");
                                    });
                                  }}
                                >
                                  Delete for me
                                </button>
                              </div>
                            ) : (
                              !!m.text && (
                                <div style={styles.msgTextRow}>
                                  <div style={styles.msgText}>{m.text}</div>
                                  <div style={styles.msgInlineMeta}>
                                    <span>{formatTime(m.createdAt)}</span>
                                    {mine && activeThread?.type !== "group" && !!dmOtherId && (
                                      <span
                                        style={{
                                          ...styles.tickPair,
                                          ...(dmSeen ? styles.tickPairSeen : styles.tickPairDelivered),
                                        }}
                                        title={dmSeen ? "Seen" : "Delivered"}
                                      >
                                        <FiCheck size={12} style={styles.tickFirst} />
                                        <FiCheck size={12} style={styles.tickSecond} />
                                      </span>
                                    )}
                                  </div>
                                </div>
                              )
                            )}

                            {!deletedForEveryone && Array.isArray(m.attachments) && m.attachments.length > 0 && (
                              <div style={styles.attachList}>
                                {m.attachments.map((a, idx) => (
                                  <div key={`${m.id}_${idx}`} style={styles.attachItem}>
                                    {String(a?.type || "").startsWith("image/") && a?.url ? (
                                      <>
                                        <button
                                          type="button"
                                          style={styles.imagePreviewBtn}
                                          onClick={() => {
                                            setImagePreview({
                                              url: a.url,
                                              name: a?.name || "Image",
                                            });
                                            setActiveMessageMenuId("");
                                          }}
                                          title="Open image"
                                        >
                                          <img src={a.url} alt={a?.name || "image"} style={styles.attachImage} loading="lazy" />
                                        </button>
                                        {!!a?.name && <div style={styles.imageCaption}>{a.name}</div>}
                                      </>
                                    ) : (
                                      <a href={a.url} target="_blank" rel="noreferrer" style={styles.attachLink}>
                                        📎 {a.name || "file"}
                                      </a>
                                    )}
                                  </div>
                                ))}
                              </div>
                            )}

                            {!showInlineMeta && (
                              <div style={styles.msgMetaRow}>
                                <span>{formatTime(m.createdAt)}</span>
                                {mine && activeThread?.type !== "group" && !!dmOtherId && (
                                  <span
                                    style={{
                                      ...styles.tickPair,
                                      ...(dmSeen ? styles.tickPairSeen : styles.tickPairDelivered),
                                    }}
                                    title={dmSeen ? "Seen" : "Delivered"}
                                  >
                                    <FiCheck size={12} style={styles.tickFirst} />
                                    <FiCheck size={12} style={styles.tickSecond} />
                                  </span>
                                )}
                                {mine && activeThread?.type === "group" && (
                                  <span style={styles.seenMark}>
                                    <FiCheckCircle size={13} /> Seen by {readUsers.length}
                                  </span>
                                )}
                              </div>
                            )}

                            {mine && activeThread?.type === "group" && readUsers.length > 0 && (
                              <div style={styles.groupSeenList}>
                                {readUsers.slice(0, 3).map((r) => (
                                  <span key={`${m.id}_${r.id}`}>{r.name} • {formatTime(r.ts)}</span>
                                ))}
                                {readUsers.length > 3 && <span>+{readUsers.length - 3} more</span>}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
                <div ref={endRef} />
              </div>

              <div style={styles.composer}>
                {pendingFiles.length > 0 && (
                  <div style={styles.pendingWrap}>
                    {pendingFilePreviews.map((item) => (
                      <span key={item.key} style={styles.pendingItem}>
                        {item.isImage && item.previewUrl ? (
                          <img src={item.previewUrl} alt={item.file?.name || "image"} style={styles.pendingThumb} />
                        ) : (
                          <span style={styles.pendingFile}>📎</span>
                        )}
                        <span style={styles.pendingMeta}>{item.file?.name || "file"}</span>
                      </span>
                    ))}
                  </div>
                )}

                <div style={styles.composerRow}>
                  <button
                    type="button"
                    style={styles.iconBtn}
                    onClick={() => fileInputRef.current?.click()}
                    title="Attach files"
                  >
                    <FiPaperclip size={16} />
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    style={{ display: "none" }}
                    multiple
                    onChange={onFilePick}
                  />

                  <input
                    type="text"
                    value={messageText}
                    onChange={(e) => setMessageText(e.target.value)}
                    onPaste={onComposerPaste}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") sendMessage();
                    }}
                    placeholder={
                      !activeThread
                        ? "Select a chat first"
                        : isMeMutedInActiveGroup
                          ? "You are muted in this group"
                          : "Type a message"
                    }
                    disabled={!activeThread || sending || isMeMutedInActiveGroup}
                    style={styles.input}
                  />

                  <button
                    type="button"
                    onClick={sendMessage}
                    disabled={!activeThread || sending || isMeMutedInActiveGroup}
                    style={styles.sendBtn}
                    title="Send"
                  >
                    <FiSend size={16} />
                  </button>
                </div>
              </div>
            </div>
          </div>

          {showGroupInfoModal && isActiveGroup && (
            <div style={styles.modalScrim}>
              <div style={styles.modalCard}>
                <div style={styles.modalHead}>
                  <h4 style={{ margin: 0 }}>Group details</h4>
                  <button
                    type="button"
                    style={styles.closeBtn}
                    onClick={() => setShowGroupInfoModal(false)}
                  >
                    <FiX size={16} />
                  </button>
                </div>

                <div style={styles.modalBody}>
                  <div style={styles.forwardHint}>Members in this group</div>

                  <div style={styles.memberList}>
                    {activeGroupMembers.map((member) => (
                      <div key={member.uid} style={styles.groupMemberRow}>
                        <div style={styles.groupMemberMain}>
                          <div style={styles.groupMemberName}>{member.name}</div>
                          <div style={styles.groupMemberEmail}>{member.email || "-"}</div>
                        </div>
                        <div style={styles.groupMemberBadges}>
                          {member.isAdmin && <span style={styles.memberBadgeAdmin}>Admin</span>}
                          {member.isMuted && <span style={styles.memberBadgeMuted}>Muted</span>}
                        </div>
                      </div>
                    ))}
                    {activeGroupMembers.length === 0 && (
                      <div style={styles.emptyHint}>No members found.</div>
                    )}
                  </div>

                  {isActiveGroupAdmin && (
                    <>
                      <div style={styles.forwardHint}>Edit group name</div>
                      <input
                        type="text"
                        value={groupNameDraft}
                        onChange={(e) => setGroupNameDraft(e.target.value)}
                        style={styles.groupNameInput}
                        placeholder="Enter group name"
                      />
                      <button
                        type="button"
                        style={styles.createGroupBtn}
                        onClick={saveGroupName}
                        disabled={groupNameSaving}
                      >
                        {groupNameSaving ? "Saving..." : "Save group name"}
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>
          )}

          {showGroupManageModal && isActiveGroup && isActiveGroupAdmin && (
            <div style={styles.modalScrim}>
              <div style={styles.modalCard}>
                <div style={styles.modalHead}>
                  <h4 style={{ margin: 0 }}>Manage group mute</h4>
                  <button
                    type="button"
                    style={styles.closeBtn}
                    onClick={() => setShowGroupManageModal(false)}
                  >
                    <FiX size={16} />
                  </button>
                </div>
                <div style={styles.modalBody}>
                  <div style={styles.forwardHint}>
                    As admin, choose members who should be muted. Muted users cannot send messages.
                  </div>

                  <div style={styles.memberList}>
                    {groupMuteCandidates.map((member) => {
                      const checked = groupMuteSelection.includes(member.uid);
                      return (
                        <label key={member.uid} style={styles.memberItem}>
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) => {
                              setGroupMuteSelection((prev) => (
                                e.target.checked
                                  ? [...prev, member.uid]
                                  : prev.filter((id) => id !== member.uid)
                              ));
                            }}
                          />
                          <span>{member.name}</span>
                          <span style={{ opacity: 0.66 }}>{member.email}</span>
                        </label>
                      );
                    })}
                    {groupMuteCandidates.length === 0 && (
                      <div style={styles.emptyHint}>No members available to mute.</div>
                    )}
                  </div>

                  <div style={styles.modalActionRow}>
                    <button
                      type="button"
                      style={styles.selectionBtn}
                      onClick={muteAllGroupMembers}
                    >
                      Mute all
                    </button>
                    <button
                      type="button"
                      style={styles.selectionBtn}
                      onClick={unmuteAllGroupMembers}
                    >
                      Unmute all
                    </button>
                  </div>

                  <button
                    type="button"
                    style={styles.createGroupBtn}
                    onClick={async () => {
                      try {
                        await saveGroupMuteSelection(groupMuteSelection);
                        setShowGroupManageModal(false);
                        alert("Group mute settings updated.");
                      } catch (err) {
                        console.error("Update mute selection failed", err);
                        alert("Unable to update mute settings right now.");
                      }
                    }}
                  >
                    Save mute settings
                  </button>
                </div>
              </div>
            </div>
          )}

          {showDmModal && (
            <div style={styles.modalScrim}>
              <div style={styles.modalCard}>
                <div style={styles.modalHead}>
                  <h4 style={{ margin: 0 }}>Start Direct Chat</h4>
                  <button type="button" style={styles.closeBtn} onClick={() => setShowDmModal(false)}>
                    <FiX size={16} />
                  </button>
                </div>
                <div style={styles.modalBody}>
                  <input
                    type="text"
                    placeholder="Search by name or email"
                    value={dmSearch}
                    onChange={(e) => setDmSearch(e.target.value)}
                    style={styles.searchInput}
                    autoFocus
                  />
                  {loadingUsers ? (
                    <div style={styles.emptyHint}>Loading users...</div>
                  ) : users.length === 0 ? (
                    <div style={styles.emptyHint}>No users available.</div>
                  ) : filteredDmUsers.length === 0 ? (
                    <div style={styles.emptyHint}>No matching users found.</div>
                  ) : (
                    filteredDmUsers.map((u) => (
                      <button
                        type="button"
                        key={u.uid}
                        onClick={() => createOrOpenDirectThread(u)}
                        style={styles.userPick}
                      >
                        <span>{u.name}</span>
                        <span style={{ opacity: 0.7 }}>{u.email}</span>
                      </button>
                    ))
                  )}
                </div>
              </div>
            </div>
          )}

          {showGroupModal && (
            <div style={styles.modalScrim}>
              <div style={styles.modalCard}>
                <div style={styles.modalHead}>
                  <h4 style={{ margin: 0 }}>Create Group</h4>
                  <button type="button" style={styles.closeBtn} onClick={() => setShowGroupModal(false)}>
                    <FiX size={16} />
                  </button>
                </div>
                <div style={styles.modalBody}>
                  <input
                    type="text"
                    placeholder="Group name"
                    value={groupName}
                    onChange={(e) => setGroupName(e.target.value)}
                    style={styles.groupNameInput}
                  />
                  <input
                    type="text"
                    placeholder="Search members by name or email"
                    value={groupMemberSearch}
                    onChange={(e) => setGroupMemberSearch(e.target.value)}
                    style={styles.searchInput}
                  />
                  <div style={styles.memberList}>
                    {filteredGroupUsers.map((u) => {
                      const checked = groupMemberIds.includes(u.uid);
                      return (
                        <label key={u.uid} style={styles.memberItem}>
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) => {
                              setGroupMemberIds((prev) =>
                                e.target.checked
                                  ? [...prev, u.uid]
                                  : prev.filter((id) => id !== u.uid)
                              );
                            }}
                          />
                          <span>{u.name}</span>
                          <span style={{ opacity: 0.66 }}>{u.email}</span>
                        </label>
                      );
                    })}
                    {!loadingUsers && users.length > 0 && filteredGroupUsers.length === 0 && (
                      <div style={styles.emptyHint}>No matching users found.</div>
                    )}
                  </div>

                  <div style={styles.groupHelperText}>
                    Select at least 1 member. You are added automatically.
                  </div>

                  <button
                    type="button"
                    style={styles.createGroupBtn}
                    onClick={createGroupThread}
                    disabled={!groupName.trim() || groupMemberIds.length < 1 || groupCreating}
                  >
                    {groupCreating ? "Creating..." : "Create Group"}
                  </button>
                </div>
              </div>
            </div>
          )}

          {showDeleteMessageModal && (
            <div style={styles.modalScrim}>
              <div style={styles.modalCard}>
                <div style={styles.modalHead}>
                  <h4 style={{ margin: 0 }}>Delete message</h4>
                  <button
                    type="button"
                    style={styles.closeBtn}
                    onClick={() => {
                      setShowDeleteMessageModal(false);
                      setDeleteTargetMessage(null);
                    }}
                  >
                    <FiX size={16} />
                  </button>
                </div>
                <div style={styles.modalBody}>
                  <div style={styles.forwardHint}>Choose how to delete this message/image.</div>
                  <button type="button" style={styles.createGroupBtn} onClick={() => deleteMessageWithMode("me")}>
                    Delete for me
                  </button>
                  {isMineMessage(deleteTargetMessage) && (
                    <button type="button" style={styles.dangerBtn} onClick={() => deleteMessageWithMode("everyone")}>
                      Delete for everyone
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}

          {showForwardModal && (
            <div style={styles.modalScrim}>
              <div style={styles.modalCard}>
                <div style={styles.modalHead}>
                  <h4 style={{ margin: 0 }}>Forward message{forwardQueue.length > 1 ? "s" : ""}</h4>
                  <button type="button" style={styles.closeBtn} onClick={() => setShowForwardModal(false)}>
                    <FiX size={16} />
                  </button>
                </div>
                <div style={styles.modalBody}>
                  <div style={styles.forwardHint}>
                    {forwardQueue.length} item{forwardQueue.length > 1 ? "s" : ""} selected
                  </div>

                  <input
                    type="text"
                    placeholder="Search users by name or email"
                    value={forwardSearch}
                    onChange={(e) => setForwardSearch(e.target.value)}
                    style={styles.searchInput}
                    autoFocus
                  />

                  <div style={styles.memberList}>
                    {forwardUsers.map((u) => {
                      const checked = forwardSelectedIds.includes(u.uid);
                      return (
                        <label key={u.uid} style={styles.memberItem}>
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) => {
                              setForwardSelectedIds((prev) => (
                                e.target.checked
                                  ? [...prev, u.uid]
                                  : prev.filter((id) => id !== u.uid)
                              ));
                            }}
                          />
                          <span>{u.name}</span>
                          <span style={{ opacity: 0.66 }}>{u.email}</span>
                        </label>
                      );
                    })}
                    {!loadingUsers && users.length > 0 && forwardUsers.length === 0 && (
                      <div style={styles.emptyHint}>No matching users found.</div>
                    )}
                  </div>

                  <button
                    type="button"
                    style={styles.createGroupBtn}
                    onClick={forwardMessagesToSelectedUsers}
                    disabled={forwardSelectedIds.length < 1 || forwarding}
                  >
                    {forwarding
                      ? "Sending..."
                      : `Send to ${forwardSelectedIds.length || 0} user${forwardSelectedIds.length === 1 ? "" : "s"}`}
                  </button>
                </div>
              </div>
            </div>
          )}

          {showInfoModal && (
            <div style={styles.modalScrim}>
              <div style={styles.modalCard}>
                <div style={styles.modalHead}>
                  <h4 style={{ margin: 0 }}>Message info</h4>
                  <button
                    type="button"
                    style={styles.closeBtn}
                    onClick={() => {
                      setShowInfoModal(false);
                      setInfoMessage(null);
                    }}
                  >
                    <FiX size={16} />
                  </button>
                </div>
                <div style={styles.modalBody}>
                  <div style={styles.infoLine}><strong>Sent by:</strong> {infoMessage?.senderName || infoMessage?.senderEmail || "User"}</div>
                  <div style={styles.infoLine}><strong>Delivered:</strong> {formatDateTime(infoMessage?.createdAt)}</div>

                  {activeThread?.type !== "group" ? (
                    (() => {
                      const otherId = (activeThread?.memberIds || []).find((id) => id !== me.uid) || "";
                      const seenByMessage = otherId ? infoMessage?.readBy?.[otherId] : null;
                      const seenByThread = otherId ? activeThread?.lastReadAt?.[otherId] : null;
                      const seenAt = toMillis(seenByMessage)
                        ? seenByMessage
                        : (toMillis(seenByThread) >= toMillis(infoMessage?.createdAt) ? seenByThread : null);
                      return (
                        <div style={styles.infoLine}>
                          <strong>Seen:</strong> {seenAt ? formatDateTime(seenAt) : "Not seen yet"}
                        </div>
                      );
                    })()
                  ) : (
                    <div style={styles.infoSeenWrap}>
                      <div style={styles.infoLine}><strong>Seen by:</strong></div>
                      {Object.entries(infoMessage?.readBy || {})
                        .filter(([uid]) => uid !== me.uid)
                        .map(([uid, ts]) => (
                          <div key={`${infoMessage?.id || "msg"}_${uid}`} style={styles.infoSeenItem}>
                            <span>{userMap.get(uid)?.name || activeThread?.memberMeta?.[uid]?.name || "User"}</span>
                            <span>{formatDateTime(ts)}</span>
                          </div>
                        ))}
                      {Object.entries(infoMessage?.readBy || {}).filter(([uid]) => uid !== me.uid).length === 0 && (
                        <div style={styles.emptyHint}>No seen receipts yet.</div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {imagePreview?.url && (
            <div style={styles.modalScrim}>
              <div style={styles.imagePreviewCard}>
                <div style={styles.imagePreviewHead}>
                  <div style={styles.imagePreviewTitle}>{imagePreview.name || "Image"}</div>
                  <button
                    type="button"
                    style={styles.closeBtn}
                    onClick={() => setImagePreview(null)}
                    title="Close image"
                  >
                    <FiX size={16} />
                  </button>
                </div>

                <div style={styles.imagePreviewBody}>
                  <img
                    src={imagePreview.url}
                    alt={imagePreview.name || "image"}
                    style={styles.imagePreviewImage}
                  />
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
}

const styles = {
  bottomBarWrap: {
    position: "fixed",
    left: 0,
    right: 0,
    bottom: 0,
    height: "58px",
    background: "linear-gradient(120deg, #7f0615 0%, #7c102f 48%, #61106f 100%)",
    color: "#fff",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "8px 14px calc(8px + env(safe-area-inset-bottom, 0px))",
    zIndex: 20,
    borderTop: "1px solid rgba(255,255,255,0.18)",
    boxShadow: "0 -6px 18px rgba(14, 6, 25, 0.32)",
    gap: 10,
  },
  bottomBarLeft: {
    minWidth: 0,
    overflow: "hidden",
    display: "flex",
    flexDirection: "column",
    gap: 4,
  },
  brandLine: {
    fontWeight: 700,
    fontSize: 14,
    whiteSpace: "nowrap",
    textOverflow: "ellipsis",
    overflow: "hidden",
  },
  contactLine: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
  },
  contactChip: {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    fontSize: 12,
    opacity: 0.95,
  },
  chatButton: {
    position: "relative",
    width: 42,
    height: 42,
    borderRadius: 999,
    border: "1px solid rgba(255,255,255,0.28)",
    background: "radial-gradient(circle at 30% 30%, #ffffff, #ffd8ee)",
    color: "#7f0615",
    display: "grid",
    placeItems: "center",
    cursor: "pointer",
    boxShadow: "0 8px 16px rgba(0,0,0,0.25)",
    flexShrink: 0,
    padding: 0,
  },
  chatBadge: {
    position: "absolute",
    top: -6,
    right: -6,
    minWidth: 18,
    height: 18,
    borderRadius: 999,
    padding: "0 4px",
    background: "#ef233c",
    color: "#fff",
    border: "1px solid #fff",
    fontSize: 10,
    fontWeight: 800,
    display: "grid",
    placeItems: "center",
    lineHeight: 1,
    boxShadow: "0 4px 10px rgba(30, 5, 12, 0.35)",
  },
  panel: {
    position: "fixed",
    background: "#fff",
    border: "1px solid rgba(128,0,0,0.18)",
    borderRadius: 14,
    zIndex: 100000,
    boxShadow: "0 16px 44px rgba(16, 8, 28, 0.38)",
    overflow: "hidden",
    display: "flex",
    flexDirection: "column",
  },
  panelDesktop: {
    right: 14,
    bottom: "calc(68px + env(safe-area-inset-bottom, 0px))",
    width: "min(30vw, 560px)",
    minWidth: 420,
    height: "min(75vh, 760px)",
  },
  panelDesktopFloating: {
    width: "min(30vw, 560px)",
    minWidth: 420,
    height: "min(75vh, 760px)",
  },
  panelFullscreen: {
    top: 8,
    left: 8,
    right: 8,
    bottom: "calc(68px + env(safe-area-inset-bottom, 0px))",
    width: "auto",
    height: "auto",
    borderRadius: 12,
  },
  panelMobile: {
    left: 8,
    right: 8,
    bottom: "calc(68px + env(safe-area-inset-bottom, 0px))",
    width: "auto",
    height: "72vh",
    borderRadius: 12,
  },
  panelHeader: {
    padding: "10px 12px",
    borderBottom: "1px solid #f0e5ec",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    background: "linear-gradient(140deg, #8b001b, #631068)",
    color: "#fff",
  },
  panelHeaderDraggable: {
    cursor: "grab",
    userSelect: "none",
    touchAction: "none",
  },
  panelHeaderActions: {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
  },
  panelTitle: { fontWeight: 800, fontSize: 16 },
  panelSub: { fontSize: 11, opacity: 0.9 },
  closeBtn: {
    border: "none",
    background: "transparent",
    color: "inherit",
    width: 28,
    height: 28,
    borderRadius: 999,
    display: "grid",
    placeItems: "center",
    cursor: "pointer",
    padding: 0,
  },
  panelBody: {
    display: "flex",
    flex: 1,
    minHeight: 0,
    background: "#fff",
  },
  threadColumn: {
    width: "46%",
    borderRight: "1px solid #f0e8ef",
    display: "flex",
    flexDirection: "column",
    minWidth: 0,
  },
  threadColumnMobile: {
    width: "100%",
    borderRight: "none",
  },
  chatColumn: {
    flex: 1,
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
  },
  chatColumnHidden: {
    display: "none",
  },
  threadTools: {
    display: "grid",
    gap: 8,
    padding: 8,
    borderBottom: "1px solid #f5edf3",
  },
  threadTabs: {
    display: "flex",
    gap: 6,
  },
  threadTabCell: {
    flex: 1,
    display: "flex",
    alignItems: "center",
    gap: 6,
    minWidth: 0,
  },
  toolBtn: {
    border: "1px solid #e7d3e4",
    background: "#fff",
    color: "#7a0f1a",
    borderRadius: 8,
    padding: "6px 8px",
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    cursor: "pointer",
    fontSize: 12,
    fontWeight: 700,
    justifyContent: "center",
    flex: 1,
    minWidth: 0,
  },
  toolBtnActive: {
    border: "1px solid #cb7eb8",
    background: "#fff0fa",
    color: "#650f49",
  },
  tabAddBtn: {
    width: 30,
    height: 30,
    border: "1px solid #d9bfd1",
    borderRadius: 8,
    background: "#fff",
    color: "#7a0f1a",
    display: "grid",
    placeItems: "center",
    cursor: "pointer",
    flexShrink: 0,
    padding: 0,
  },
  threadList: {
    flex: 1,
    overflowY: "auto",
    padding: 8,
    display: "flex",
    flexDirection: "column",
    gap: 6,
  },
  threadItem: {
    border: "1px solid #f1e4ef",
    background: "#fff",
    borderRadius: 8,
    textAlign: "left",
    padding: 8,
    height: 72,
    boxSizing: "border-box",
    cursor: "pointer",
    display: "grid",
    gap: 4,
    alignContent: "center",
    flexShrink: 0,
  },
  threadItemActive: {
    border: "1px solid #c979b6",
    background: "#fff2fb",
  },
  threadTitleRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 6,
  },
  threadTitle: {
    fontSize: 12,
    fontWeight: 700,
    color: "#5c0b39",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  threadTime: {
    fontSize: 10,
    color: "#8f6f83",
    flexShrink: 0,
  },
  threadPreviewRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 6,
  },
  threadPreview: {
    fontSize: 11,
    color: "#6f5167",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 999,
    background: "#de2b65",
    flexShrink: 0,
  },
  emptyHint: {
    fontSize: 12,
    color: "#8a6a80",
    textAlign: "center",
    padding: 14,
  },
  chatTopBar: {
    borderBottom: "1px solid #f4ebf1",
    padding: "8px 10px",
    display: "flex",
    alignItems: "center",
    gap: 8,
  },
  selectBtn: {
    marginLeft: 4,
    border: "1px solid #ead3e4",
    background: "#fff",
    borderRadius: 8,
    padding: "5px 8px",
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    cursor: "pointer",
    color: "#5d2149",
    fontSize: 11,
    fontWeight: 700,
    flexShrink: 0,
  },
  threadMenuWrap: {
    marginLeft: "auto",
    position: "relative",
    flexShrink: 0,
  },
  threadMenuBtn: {
    border: "none",
    background: "transparent",
    borderRadius: 0,
    width: 24,
    height: 24,
    display: "grid",
    placeItems: "center",
    cursor: "pointer",
    color: "#5d2149",
    padding: 0,
  },
  threadMenuPanel: {
    position: "absolute",
    right: 0,
    top: 34,
    width: 150,
    border: "1px solid #e7d2e3",
    background: "#fff",
    borderRadius: 8,
    boxShadow: "0 10px 20px rgba(20, 8, 28, 0.2)",
    overflow: "hidden",
    zIndex: 5,
  },
  threadMenuItem: {
    border: "none",
    borderBottom: "1px solid #f2e6ef",
    width: "100%",
    padding: "9px 10px",
    textAlign: "left",
    background: "#fff",
    color: "#4f2241",
    fontSize: 12,
    cursor: "pointer",
  },
  threadMenuItemDanger: {
    color: "#b20d3a",
    fontWeight: 700,
  },
  backBtn: {
    border: "1px solid #ead3e4",
    background: "#fff",
    borderRadius: 8,
    width: 28,
    height: 28,
    cursor: "pointer",
    fontWeight: 700,
    flexShrink: 0,
  },
  activeTitle: {
    fontSize: 13,
    fontWeight: 800,
    color: "#581741",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  activeSub: {
    fontSize: 11,
    color: "#8d6f83",
  },
  activeThreadInfoBtn: {
    border: "none",
    background: "transparent",
    padding: 0,
    margin: 0,
    textAlign: "left",
    cursor: "pointer",
    display: "grid",
    gap: 1,
    width: "100%",
  },
  msgList: {
    flex: 1,
    overflowY: "auto",
    overflowX: "visible",
    padding: "10px 10px 6px",
    background: "linear-gradient(180deg, #fff 0%, #fff8fc 100%)",
  },
  selectionBar: {
    border: "1px solid #ebd2e6",
    background: "#fff2fb",
    borderRadius: 8,
    padding: "6px 8px",
    marginBottom: 8,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    fontSize: 11,
    color: "#5f2a4d",
  },
  selectionActions: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
  },
  selectionBtn: {
    border: "1px solid #e7cfe2",
    background: "#fff",
    borderRadius: 7,
    padding: "4px 7px",
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    cursor: "pointer",
    color: "#5c2a49",
    fontSize: 11,
    fontWeight: 700,
  },
  emptyCenter: {
    textAlign: "center",
    color: "#8f6e83",
    fontSize: 12,
    marginTop: 20,
  },
  chatStatusHint: {
    fontSize: 11,
    color: "#7a5b70",
    textAlign: "center",
    border: "1px solid #f1ddeb",
    background: "#fff4fb",
    borderRadius: 8,
    padding: "6px 8px",
    marginBottom: 8,
  },
  msgBubbleWrap: {
    display: "flex",
    width: "100%",
    justifyContent: "flex-start",
    marginBottom: 8,
  },
  msgBubbleWrapMine: {
    justifyContent: "flex-end",
  },
  msgBubbleCard: {
    display: "flex",
    alignItems: "flex-start",
    gap: 6,
    maxWidth: "100%",
  },
  msgBubbleCardMine: {
    marginLeft: "auto",
  },
  msgBubbleCardOther: {
    marginRight: "auto",
  },
  msgBubbleCardSelectable: {
    width: "100%",
  },
  msgBubbleCardSelected: {
    filter: "drop-shadow(0 0 0 rgba(0,0,0,0))",
  },
  msgSelectToggle: {
    border: "1px solid #e7d1e3",
    background: "#fff",
    color: "#6f3a5f",
    borderRadius: 6,
    width: 24,
    height: 24,
    display: "grid",
    placeItems: "center",
    cursor: "pointer",
    marginTop: 4,
    flexShrink: 0,
  },
  msgSelectToggleOn: {
    borderColor: "#bd4b95",
    color: "#8a1759",
    background: "#ffe8f5",
  },
  msgBubble: {
    maxWidth: "92%",
    borderRadius: 16,
    padding: "6px 8px",
    border: "1px solid #ecd9e7",
    boxShadow: "0 2px 8px rgba(80, 16, 57, 0.06)",
    fontSize: 12,
    position: "relative",
    width: "auto",
    display: "inline-block",
  },
  msgBubbleMine: {
    background: "linear-gradient(135deg, #ffeaf7, #ffe0f2)",
    borderColor: "#eec8e1",
    maxWidth: "82%",
    borderTopRightRadius: 6,
  },
  msgBubbleOther: {
    background: "#fff",
    maxWidth: "82%",
    borderTopLeftRadius: 6,
  },
  msgSender: {
    fontSize: 10,
    fontWeight: 700,
    color: "#7d3862",
    marginBottom: 4,
  },
  msgTopRow: {
    display: "block",
    minHeight: 0,
  },
  msgActionsWrap: {
    position: "absolute",
    top: 2,
    right: 2,
    zIndex: 2,
  },
  msgActionBtn: {
    border: "none",
    background: "transparent",
    color: "#6e2e57",
    borderRadius: 0,
    width: 22,
    height: 22,
    display: "grid",
    placeItems: "center",
    cursor: "pointer",
    padding: 0,
  },
  msgMenu: {
    position: "absolute",
    top: 24,
    width: 168,
    borderRadius: 8,
    border: "1px solid #e7d3e3",
    background: "#fff",
    boxShadow: "0 10px 20px rgba(18, 8, 28, 0.2)",
    display: "grid",
    overflow: "hidden",
  },
  msgMenuRight: {
    right: 0,
    left: "auto",
  },
  msgMenuLeft: {
    left: 0,
    right: "auto",
  },
  msgMenuBtn: {
    border: "none",
    borderBottom: "1px solid #f2e5ef",
    background: "#fff",
    color: "#552443",
    textAlign: "left",
    padding: "7px 8px",
    fontSize: 11,
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    cursor: "pointer",
    width: "100%",
    whiteSpace: "nowrap",
  },
  msgMenuBtnDanger: {
    color: "#b20d3a",
    fontWeight: 700,
  },
  forwardedTag: {
    display: "inline-flex",
    alignItems: "center",
    fontSize: 10,
    fontWeight: 700,
    color: "#78446a",
    background: "rgba(120, 68, 106, 0.12)",
    borderRadius: 999,
    padding: "2px 7px",
    marginBottom: 5,
  },
  msgText: {
    whiteSpace: "pre-wrap",
    overflowWrap: "anywhere",
    color: "#3a2030",
    marginTop: 2,
    paddingRight: 0,
    lineHeight: 1.35,
    display: "inline",
  },
  msgTextRow: {
    display: "block",
    overflow: "hidden",
  },
  msgInlineMeta: {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    fontSize: 10,
    color: "#7d6174",
    whiteSpace: "nowrap",
    paddingBottom: 1,
    float: "right",
    marginLeft: 6,
    marginTop: 2,
  },
  deletedMsgRow: {
    display: "grid",
    gap: 6,
  },
  deletedMsgText: {
    fontStyle: "italic",
    color: "#8d6a81",
    fontSize: 11,
  },
  deletedMsgRemoveBtn: {
    justifySelf: "flex-start",
    border: "1px solid #e4c7d8",
    background: "#fff",
    color: "#7f0b4b",
    borderRadius: 6,
    padding: "3px 7px",
    fontSize: 10,
    fontWeight: 700,
    cursor: "pointer",
  },
  attachList: {
    display: "grid",
    gap: 3,
    marginTop: 4,
  },
  attachItem: {
    display: "grid",
    gap: 3,
    justifyItems: "start",
  },
  imageLink: {
    textDecoration: "none",
    display: "inline-block",
    maxWidth: 220,
  },
  imagePreviewBtn: {
    border: "none",
    background: "transparent",
    padding: 0,
    borderRadius: 10,
    cursor: "zoom-in",
    display: "inline-block",
    width: "100%",
    maxWidth: 220,
  },
  attachImage: {
    display: "block",
    width: "100%",
    maxWidth: 220,
    maxHeight: 220,
    objectFit: "cover",
    borderRadius: 10,
    border: "1px solid #efdce9",
  },
  imageCaption: {
    fontSize: 10,
    color: "#7e5f73",
    maxWidth: 220,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    lineHeight: 1.2,
  },
  attachLink: {
    color: "#7f0b4b",
    textDecoration: "none",
    fontSize: 11,
    background: "rgba(127, 11, 75, 0.06)",
    padding: "3px 6px",
    borderRadius: 6,
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
  },
  msgMetaRow: {
    marginTop: 4,
    display: "flex",
    justifyContent: "flex-end",
    alignItems: "center",
    gap: 6,
    fontSize: 10,
    color: "#7d6174",
    whiteSpace: "nowrap",
  },
  seenMark: {
    display: "inline-flex",
    alignItems: "center",
    gap: 3,
    color: "#5d2a52",
  },
  tickPair: {
    position: "relative",
    width: 16,
    height: 12,
    display: "inline-block",
    flexShrink: 0,
  },
  tickPairDelivered: {
    color: "#7d6174",
  },
  tickPairSeen: {
    color: "#2f9fff",
  },
  tickFirst: {
    position: "absolute",
    left: 0,
    top: 0,
  },
  tickSecond: {
    position: "absolute",
    left: 6,
    top: 0,
  },
  groupSeenList: {
    marginTop: 4,
    display: "grid",
    gap: 2,
    fontSize: 10,
    color: "#7b5f74",
  },
  composer: {
    borderTop: "1px solid #f2e8ef",
    padding: 8,
    background: "#fff",
    display: "grid",
    gap: 6,
  },
  composerRow: {
    display: "grid",
    gridTemplateColumns: "34px 1fr 34px",
    gap: 6,
    alignItems: "center",
  },
  iconBtn: {
    border: "1px solid #ebd7e6",
    background: "#fff",
    borderRadius: 8,
    width: 34,
    height: 34,
    display: "grid",
    placeItems: "center",
    cursor: "pointer",
    padding: 0,
    color: "#6f1f58",
  },
  input: {
    border: "1px solid #ebd9e8",
    borderRadius: 8,
    padding: "8px 9px",
    fontSize: 12,
    outline: "none",
    minWidth: 0,
  },
  sendBtn: {
    border: "none",
    background: "linear-gradient(135deg, #8f0d21, #70106c)",
    color: "#fff",
    borderRadius: 8,
    width: 34,
    height: 34,
    display: "grid",
    placeItems: "center",
    cursor: "pointer",
    padding: 0,
  },
  pendingWrap: {
    display: "flex",
    flexWrap: "wrap",
    gap: 4,
  },
  pendingItem: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    fontSize: 10,
    borderRadius: 999,
    background: "#f7e5f4",
    border: "1px solid #ebd0e4",
    color: "#6f1f58",
    padding: "2px 8px 2px 4px",
    maxWidth: 170,
  },
  pendingThumb: {
    width: 22,
    height: 22,
    borderRadius: 5,
    objectFit: "cover",
    border: "1px solid #e2bfd5",
    flexShrink: 0,
  },
  pendingFile: {
    display: "inline-grid",
    placeItems: "center",
    width: 22,
    height: 22,
    borderRadius: 5,
    background: "#fff",
    border: "1px solid #e2bfd5",
  },
  pendingMeta: {
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  modalScrim: {
    position: "absolute",
    inset: 0,
    background: "rgba(12, 8, 20, 0.5)",
    display: "grid",
    placeItems: "center",
    padding: 12,
    zIndex: 12,
  },
  modalCard: {
    width: "min(100%, 420px)",
    maxHeight: "88%",
    background: "#fff",
    borderRadius: 12,
    border: "1px solid #ebd8e7",
    boxShadow: "0 16px 34px rgba(14, 10, 26, 0.35)",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
  },
  imagePreviewCard: {
    width: "min(100%, 760px)",
    height: "min(86vh, 680px)",
    background: "#fff",
    borderRadius: 12,
    border: "1px solid #ebd8e7",
    boxShadow: "0 16px 34px rgba(14, 10, 26, 0.35)",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
  },
  imagePreviewHead: {
    padding: "10px 12px",
    borderBottom: "1px solid #f2e6ef",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    color: "#5c0d41",
    background: "#fff",
  },
  imagePreviewTitle: {
    fontSize: 12,
    fontWeight: 700,
    color: "#5d2248",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    paddingRight: 8,
  },
  imagePreviewBody: {
    flex: 1,
    minHeight: 0,
    background: "#111018",
    display: "grid",
    placeItems: "center",
    padding: 10,
  },
  imagePreviewImage: {
    maxWidth: "100%",
    maxHeight: "100%",
    objectFit: "contain",
    borderRadius: 8,
  },
  modalHead: {
    padding: "10px 12px",
    borderBottom: "1px solid #f2e6ef",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    color: "#5c0d41",
  },
  modalBody: {
    padding: 10,
    overflowY: "auto",
    display: "grid",
    gap: 8,
  },
  userPick: {
    border: "1px solid #edd9e8",
    background: "#fff",
    borderRadius: 8,
    padding: "8px 9px",
    display: "grid",
    gap: 2,
    textAlign: "left",
    cursor: "pointer",
    color: "#4f1d3f",
    fontSize: 12,
  },
  groupNameInput: {
    border: "1px solid #ebd6e5",
    borderRadius: 8,
    padding: "9px 10px",
    fontSize: 13,
    outline: "none",
  },
  searchInput: {
    border: "1px solid #ebd6e5",
    borderRadius: 8,
    padding: "9px 10px",
    fontSize: 13,
    outline: "none",
  },
  memberList: {
    display: "grid",
    gap: 6,
    maxHeight: 220,
    overflowY: "auto",
    border: "1px solid #f2e6ef",
    borderRadius: 8,
    padding: 8,
  },
  groupMemberRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 8,
    border: "1px solid #f0e3ed",
    borderRadius: 8,
    padding: "8px 9px",
    background: "#fff",
  },
  groupMemberMain: {
    minWidth: 0,
  },
  groupMemberName: {
    fontSize: 12,
    fontWeight: 700,
    color: "#552443",
  },
  groupMemberEmail: {
    fontSize: 11,
    color: "#835f76",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    maxWidth: 210,
  },
  groupMemberBadges: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    flexShrink: 0,
  },
  memberBadgeAdmin: {
    fontSize: 10,
    color: "#5d2348",
    border: "1px solid #dcb1cf",
    background: "#fff0fa",
    borderRadius: 999,
    padding: "2px 7px",
    fontWeight: 700,
  },
  memberBadgeMuted: {
    fontSize: 10,
    color: "#7b2a4f",
    border: "1px solid #e5bfd1",
    background: "#ffeaf4",
    borderRadius: 999,
    padding: "2px 7px",
    fontWeight: 700,
  },
  memberItem: {
    display: "grid",
    gridTemplateColumns: "16px 1fr",
    columnGap: 8,
    rowGap: 1,
    alignItems: "center",
    fontSize: 12,
    color: "#542341",
  },
  groupHelperText: {
    fontSize: 11,
    color: "#7a5b70",
    marginTop: -2,
  },
  createGroupBtn: {
    border: "none",
    borderRadius: 9,
    padding: "9px 12px",
    background: "linear-gradient(135deg, #8f0d21, #70106c)",
    color: "#fff",
    fontWeight: 700,
    cursor: "pointer",
  },
  dangerBtn: {
    border: "none",
    borderRadius: 9,
    padding: "9px 12px",
    background: "linear-gradient(135deg, #d6134f, #a00e3d)",
    color: "#fff",
    fontWeight: 700,
    cursor: "pointer",
  },
  forwardHint: {
    fontSize: 12,
    color: "#70435f",
    background: "#fff1fa",
    border: "1px solid #eed3e8",
    borderRadius: 8,
    padding: "6px 8px",
  },
  modalActionRow: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 8,
  },
  infoLine: {
    fontSize: 12,
    color: "#4f2540",
  },
  infoSeenWrap: {
    border: "1px solid #f1e3ee",
    borderRadius: 8,
    padding: 8,
    display: "grid",
    gap: 6,
  },
  infoSeenItem: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 8,
    borderBottom: "1px solid #f5ebf2",
    paddingBottom: 4,
    fontSize: 11,
    color: "#61304f",
  },
};
