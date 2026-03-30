import React, { useEffect, useMemo, useRef, useState } from "react";
import { collection, deleteDoc, doc, limit, onSnapshot, orderBy, query, updateDoc } from "firebase/firestore";
import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { useNavigate } from "react-router-dom";
import { db, storage } from "../firebaseConfig";
import { useAuth } from "../context/AuthContext";
import { saveDraftApi, sendMailApi } from "../api/mailApi";

const folders = ["inbox", "sent", "draft", "trash"];

const asDate = (value) => {
  if (!value) return null;
  if (value?.toDate) return value.toDate();
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
};

const fmtDate = (value) => {
  const d = asDate(value);
  if (!d) return "";
  return d.toLocaleString();
};

const splitRecipientValues = (value) =>
  String(value || "")
    .split(/[;,\s]+/g)
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean);

const trimRecipients = (value) => splitRecipientValues(value).join(", ");

const getActiveRecipientToken = (value) => {
  const raw = String(value || "").replace(/;/g, ",");
  const idx = raw.lastIndexOf(",");
  return (idx >= 0 ? raw.slice(idx + 1) : raw).trim().toLowerCase();
};

const injectRecipient = (currentValue, email) => {
  const raw = String(currentValue || "").replace(/;/g, ",");
  const existing = splitRecipientValues(raw);
  const normalized = String(email || "").trim().toLowerCase();
  if (!normalized || existing.includes(normalized)) return raw;

  const idx = raw.lastIndexOf(",");
  const prefix = idx >= 0 ? raw.slice(0, idx + 1) : "";
  const spacer = prefix && !prefix.endsWith(" ") ? " " : "";
  return `${prefix}${spacer}${normalized}, `;
};

const formatBytes = (bytes) => {
  const n = Number(bytes || 0);
  if (!Number.isFinite(n) || n <= 0) return "0 B";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
};

const friendlyAuthError = (err) => {
  const msg = String(err?.message || "");
  if (
    /auth\/id-token-expired|id token has expired|session expired|auth token missing/i.test(msg)
  ) {
    return "Session expired. Please re-login and try again.";
  }
  return msg || "Request failed";
};

const normalizeFileName = (name) =>
  String(name || "attachment")
    .replace(/[\s]+/g, "_")
    .replace(/[^a-zA-Z0-9._-]/g, "")
    .slice(0, 120);

const isImageAttachment = (file = {}) => String(file?.contentType || "").toLowerCase().startsWith("image/");

const htmlToPlainText = (value) =>
  String(value || "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

const plainToHtml = (value) =>
  String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\n/g, "<br />");

const INLINE_IMAGE_WRAP_CLASS = "mail-inline-image-wrap";

const makeInlineImageId = () => `inline-img-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const buildResizableImageMarkup = ({ src, alt = "image", token = "", uploadState = "done" }) => {
  const safeSrc = String(src || "").trim();
  if (!safeSrc) return "";
  const safeAlt = String(alt || "image").replace(/"/g, "&quot;");
  const safeToken = String(token || "").replace(/"/g, "");
  const safeUploadState = String(uploadState || "done").replace(/"/g, "");

  return `
    <span class="${INLINE_IMAGE_WRAP_CLASS}" contenteditable="false" style="display:inline-block; resize:both; overflow:hidden; max-width:100%; width:min(420px, 100%); min-width:120px; min-height:90px; border:1px solid #d8c7db; border-radius:10px; margin:8px 0; vertical-align:top; background:#fff;">
      <img src="${safeSrc}" alt="${safeAlt}" data-inline-upload="${safeUploadState}" ${safeToken ? `data-upload-token="${safeToken}"` : ""} style="width:100%; height:100%; display:block; object-fit:contain; object-position:center;" />
    </span>
  `;
};

export default function MailSetupPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const localUser = useMemo(() => {
    try {
      return JSON.parse(localStorage.getItem("kp-user") || "{}");
    } catch {
      return {};
    }
  }, []);

  const uid = user?.uid || localUser?.uid || "";
  const currentEmail = String(user?.email || localUser?.email || "").toLowerCase();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [folder, setFolder] = useState("inbox");
  const [search, setSearch] = useState("");
  const [messages, setMessages] = useState([]);
  const [selectedId, setSelectedId] = useState("");
  const [actionBusyId, setActionBusyId] = useState("");
  const [isNarrow, setIsNarrow] = useState(() => (typeof window !== "undefined" ? window.innerWidth < 980 : false));
  const [isMobile, setIsMobile] = useState(() => (typeof window !== "undefined" ? window.innerWidth < 768 : false));

  const [composeOpen, setComposeOpen] = useState(false);
  const [compose, setCompose] = useState({
    draftId: "",
    to: "",
    cc: "",
    bcc: "",
    subject: "",
    body: "",
    bodyHtml: "",
    attachments: [],
  });
  const [savingDraft, setSavingDraft] = useState(false);
  const [sending, setSending] = useState(false);
  const [uploadingFiles, setUploadingFiles] = useState(false);
  const [pendingInlineUploads, setPendingInlineUploads] = useState(0);
  const [selectedInlineImageId, setSelectedInlineImageId] = useState("");
  const [directoryUsers, setDirectoryUsers] = useState([]);
  const [activeRecipientField, setActiveRecipientField] = useState("");
  const composeEditorRef = useRef(null);
  const pendingInlineUploadPromisesRef = useRef(new Set());

  const syncInlineImageSelection = (activeId = "") => {
    const editor = composeEditorRef.current;
    if (!editor) return;

    editor.querySelectorAll("img").forEach((img) => {
      if (!img.getAttribute("data-inline-id")) {
        img.setAttribute("data-inline-id", makeInlineImageId());
      }
      const isSelected = !!activeId && img.getAttribute("data-inline-id") === activeId;
      img.style.boxShadow = isSelected ? "0 0 0 2px #8f1123 inset" : "none";
      img.style.cursor = "pointer";
      img.title = isSelected ? "Click Remove selected image" : (img.title || "Click image to remove");
    });
  };

  const ensureEditorImageWrappers = () => {
    const editor = composeEditorRef.current;
    if (!editor) return;

    editor.querySelectorAll("img").forEach((img) => {
      if (!img.getAttribute("data-inline-id")) {
        img.setAttribute("data-inline-id", makeInlineImageId());
      }

      const parent = img.parentElement;
      if (parent?.classList?.contains(INLINE_IMAGE_WRAP_CLASS)) {
        parent.style.display = "inline-block";
        parent.style.resize = "both";
        parent.style.overflow = "hidden";
        parent.style.maxWidth = "100%";
        parent.style.minWidth = parent.style.minWidth || "120px";
        parent.style.minHeight = parent.style.minHeight || "90px";
        parent.style.borderRadius = parent.style.borderRadius || "10px";
        parent.style.background = parent.style.background || "#fff";
        img.style.width = "100%";
        img.style.height = "100%";
        img.style.display = "block";
        img.style.objectFit = "contain";
        img.style.objectPosition = "center";
        return;
      }

      const wrapper = document.createElement("span");
      wrapper.className = INLINE_IMAGE_WRAP_CLASS;
      wrapper.setAttribute("contenteditable", "false");
      wrapper.style.display = "inline-block";
      wrapper.style.resize = "both";
      wrapper.style.overflow = "hidden";
      wrapper.style.maxWidth = "100%";
      wrapper.style.width = "min(420px, 100%)";
      wrapper.style.minWidth = "120px";
      wrapper.style.minHeight = "90px";
      wrapper.style.border = "1px solid #d8c7db";
      wrapper.style.borderRadius = "10px";
      wrapper.style.margin = "8px 0";
      wrapper.style.verticalAlign = "top";
      wrapper.style.background = "#fff";

      img.style.width = "100%";
      img.style.height = "100%";
      img.style.maxHeight = "none";
      img.style.display = "block";
      img.style.objectFit = "contain";
      img.style.objectPosition = "center";

      const imgParent = img.parentNode;
      if (!imgParent) return;
      imgParent.insertBefore(wrapper, img);
      wrapper.appendChild(img);
    });

    syncInlineImageSelection(selectedInlineImageId);
  };

  useEffect(() => {
    if (!uid) {
      setLoading(false);
      return undefined;
    }

    setLoading(true);
    setError("");

    const q = query(
      collection(db, "mailboxes", uid, "messages"),
      orderBy("updatedAt", "desc"),
      limit(300)
    );

    const unsub = onSnapshot(
      q,
      (snap) => {
        const rows = snap.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));
        setMessages(rows);
        setLoading(false);
      },
      (errSnap) => {
        console.warn("Mail snapshot failed", errSnap);
        setError(errSnap?.message || "Failed to load mail.");
        setLoading(false);
      }
    );

    return () => unsub();
  }, [uid]);

  useEffect(() => {
    if (!uid) return undefined;

    const q = query(collection(db, "Users"), limit(500));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const list = snap.docs
          .map((d) => ({ id: d.id, ...(d.data() || {}) }))
          .map((u) => ({
            id: u.id,
            email: String(u.email || u.Email || "").trim().toLowerCase(),
            name: String(u.Name || u.name || u.displayName || "").trim(),
          }))
          .filter((u) => u.email.includes("@"));
        setDirectoryUsers(list);
      },
      () => setDirectoryUsers([])
    );

    return () => unsub();
  }, [uid]);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const onResize = () => {
      setIsNarrow(window.innerWidth < 980);
      setIsMobile(window.innerWidth < 768);
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return messages.filter((m) => {
      if (m.folder !== folder) return false;
      if (!needle) return true;

      const bag = [
        m.subject,
        m.body,
        m.preview,
        m.fromEmail,
        m.fromName,
        ...(Array.isArray(m.toEmails) ? m.toEmails : []),
      ]
        .join(" ")
        .toLowerCase();

      return bag.includes(needle);
    });
  }, [messages, folder, search]);

  const selected = useMemo(() => {
    if (!filtered.length) return null;
    return filtered.find((m) => m.id === selectedId) || filtered[0];
  }, [filtered, selectedId]);

  const recipientSuggestions = useMemo(() => {
    if (!composeOpen || !activeRecipientField) return [];
    const token = getActiveRecipientToken(compose[activeRecipientField]);
    if (!token) return [];

    const existing = splitRecipientValues(compose[activeRecipientField]);

    return directoryUsers
      .filter((u) => {
        if (!u.email || existing.includes(u.email)) return false;
        const name = String(u.name || "").toLowerCase();
        return u.email.includes(token) || name.includes(token);
      })
      .slice(0, 8);
  }, [composeOpen, activeRecipientField, compose, directoryUsers]);

  const knownDirectoryEmails = useMemo(
    () => new Set(directoryUsers.map((u) => u.email).filter(Boolean)),
    [directoryUsers]
  );

  useEffect(() => {
    if (!filtered.length) {
      setSelectedId("");
      return;
    }
    if (!selectedId || !filtered.some((m) => m.id === selectedId)) {
      setSelectedId(filtered[0].id);
    }
  }, [filtered, selectedId]);

  useEffect(() => {
    if (!selected) return;
    if (selected.folder === "inbox" && !selected.isRead && selected.id) {
      updateMessage(selected.id, { isRead: true, readAt: new Date() }).catch(() => {});
    }
  }, [selected?.id]);

  useEffect(() => {
    if (!composeOpen || !composeEditorRef.current) return;
    composeEditorRef.current.innerHTML = compose.bodyHtml || "";
    ensureEditorImageWrappers();
  }, [composeOpen, compose.draftId]);

  useEffect(() => {
    if (!composeOpen) return;
    syncInlineImageSelection(selectedInlineImageId);
  }, [selectedInlineImageId, composeOpen]);

  const updateMessage = async (messageId, patch) => {
    if (!uid || !messageId) return;
    setActionBusyId(messageId);
    try {
      await updateDoc(doc(db, "mailboxes", uid, "messages", messageId), {
        ...patch,
        updatedAt: new Date(),
      });
    } finally {
      setActionBusyId("");
    }
  };

  const moveToTrash = async (mail) => {
    if (!mail) return;
    await updateMessage(mail.id, {
      previousFolder: mail.folder || "inbox",
      folder: "trash",
    });
  };

  const restoreMail = async (mail) => {
    if (!mail) return;
    const fallback = mail.fromUid === uid ? "sent" : "inbox";
    await updateMessage(mail.id, { folder: mail.previousFolder || fallback });
  };

  const deleteForever = async (mail) => {
    if (!mail || !uid) return;
    if (!window.confirm("Delete this mail permanently?")) return;
    await deleteDoc(doc(db, "mailboxes", uid, "messages", mail.id));
  };

  const setComposeField = (field, value) => {
    setCompose((prev) => ({ ...prev, [field]: value }));
  };

  const openCompose = () => {
    setComposeOpen(true);
    setActiveRecipientField("to");
    setSelectedInlineImageId("");
    setCompose({ draftId: "", to: "", cc: "", bcc: "", subject: "", body: "", bodyHtml: "", attachments: [] });
  };

  const openDraft = (mail) => {
    setComposeOpen(true);
    setActiveRecipientField("to");
    setSelectedInlineImageId("");
    setCompose({
      draftId: mail.id || "",
      to: (mail.toEmails || []).join(", "),
      cc: (mail.ccEmails || []).join(", "),
      bcc: (mail.bccEmails || []).join(", "),
      subject: mail.subject || "",
      body: mail.body || "",
      bodyHtml: mail.bodyHtml || plainToHtml(mail.body || ""),
      attachments: Array.isArray(mail.attachments) ? mail.attachments : [],
    });
  };

  const openReply = (mail) => {
    if (!mail) return;
    setComposeOpen(true);
    setActiveRecipientField("to");
    setSelectedInlineImageId("");
    setCompose({
      draftId: "",
      to: mail.fromEmail || "",
      cc: "",
      bcc: "",
      subject: mail.subject?.toLowerCase()?.startsWith("re:") ? mail.subject : `Re: ${mail.subject || ""}`,
      body: `\n\n---- Original message ----\nFrom: ${mail.fromName || ""} <${mail.fromEmail || ""}>\nDate: ${fmtDate(mail.sentAt || mail.updatedAt)}\n\n${mail.body || ""}`,
      bodyHtml: plainToHtml(`\n\n---- Original message ----\nFrom: ${mail.fromName || ""} <${mail.fromEmail || ""}>\nDate: ${fmtDate(mail.sentAt || mail.updatedAt)}\n\n${mail.body || ""}`),
      attachments: [],
    });
  };

  const applyRecipientSuggestion = (field, email) => {
    setCompose((prev) => ({
      ...prev,
      [field]: injectRecipient(prev[field], email),
    }));
    setActiveRecipientField(field);
  };

  const uploadComposeFiles = async (inputFiles = [], { appendToAttachments = true } = {}) => {
    const files = Array.from(inputFiles || []).filter(Boolean);
    if (!uid || !files.length) return;

    const MAX_FILE_SIZE = 10 * 1024 * 1024;
    const MAX_ATTACHMENTS = 10;
    const availableSlots = Math.max(0, MAX_ATTACHMENTS - (compose.attachments?.length || 0));
    if (availableSlots <= 0) {
      alert("Maximum 10 attachments allowed.");
      return [];
    }

    const accepted = files.slice(0, availableSlots).filter((file) => {
      if (file.size > MAX_FILE_SIZE) {
        alert(`${file.name || "File"} is larger than 10 MB.`);
        return false;
      }
      return true;
    });

    if (!accepted.length) return [];

    setUploadingFiles(true);
    try {
      const uploadSingleFile = async (file) => {
        const fallbackName = `pasted-image-${Date.now()}.png`;
        const safeName = normalizeFileName(file.name || fallbackName);
        const storagePath = `mail/${uid}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}_${safeName}`;
        const fileRef = ref(storage, storagePath);
        await uploadBytes(fileRef, file);
        const url = await getDownloadURL(fileRef);
        return {
          name: file.name || fallbackName,
          size: file.size,
          contentType: file.type || "application/octet-stream",
          path: storagePath,
          url,
        };
      };

      const uploaded = await Promise.all(accepted.map(uploadSingleFile));

      if (appendToAttachments) {
        setCompose((prev) => ({
          ...prev,
          attachments: [...(prev.attachments || []), ...uploaded],
        }));
      }
      return uploaded;
    } catch (uploadErr) {
      alert(uploadErr?.message || "File upload failed");
      return [];
    } finally {
      setUploadingFiles(false);
    }
  };

  const insertHtmlAtCursor = (html) => {
    const selection = window.getSelection?.();
    if (!selection || selection.rangeCount === 0) {
      if (composeEditorRef.current) {
        composeEditorRef.current.innerHTML += html;
      }
      return;
    }

    const range = selection.getRangeAt(0);
    range.deleteContents();

    const temp = document.createElement("div");
    temp.innerHTML = html;
    const fragment = document.createDocumentFragment();
    let node;
    let lastNode = null;

    while ((node = temp.firstChild)) {
      lastNode = fragment.appendChild(node);
    }

    range.insertNode(fragment);
    if (lastNode) {
      range.setStartAfter(lastNode);
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);
    }
  };

  const trackInlineUpload = (promise) => {
    pendingInlineUploadPromisesRef.current.add(promise);
    setPendingInlineUploads(pendingInlineUploadPromisesRef.current.size);

    promise.finally(() => {
      pendingInlineUploadPromisesRef.current.delete(promise);
      setPendingInlineUploads(pendingInlineUploadPromisesRef.current.size);
    });
  };

  const waitForInlineUploads = async () => {
    const pending = Array.from(pendingInlineUploadPromisesRef.current);
    if (!pending.length) return;
    await Promise.allSettled(pending);
  };

  const hasUnresolvedInlineImages = () => {
    const editor = composeEditorRef.current;
    if (!editor) return false;
    return !!editor.querySelector('img[data-inline-upload="pending"], img[data-inline-upload="failed"], img[src^="blob:"]');
  };

  const hasDraftableComposeContent = () => {
    const html = String(composeEditorRef.current?.innerHTML || compose.bodyHtml || "").trim();
    const text = htmlToPlainText(html);
    return !!(
      String(compose.to || "").trim() ||
      String(compose.cc || "").trim() ||
      String(compose.bcc || "").trim() ||
      String(compose.subject || "").trim() ||
      String(text || "").trim() ||
      (compose.attachments || []).length
    );
  };

  const saveCurrentDraft = async ({ silent = false } = {}) => {
    if (!uid) throw new Error("Session expired. Please login again.");

    await waitForInlineUploads();
    handleEditorInput();
    if (hasUnresolvedInlineImages()) {
      throw new Error("Some pasted images are still uploading or failed. Please wait, then retry save.");
    }

    const editorHtml = String(composeEditorRef.current?.innerHTML || compose.bodyHtml || "");
    const editorBody = htmlToPlainText(editorHtml);
    const result = await saveDraftApi({
      draftId: compose.draftId || undefined,
      to: trimRecipients(compose.to),
      cc: trimRecipients(compose.cc),
      bcc: trimRecipients(compose.bcc),
      subject: compose.subject,
      body: editorBody,
      bodyHtml: editorHtml,
      attachments: compose.attachments || [],
    });

    setCompose((prev) => ({
      ...prev,
      draftId: result?.id || prev.draftId,
      body: editorBody,
      bodyHtml: editorHtml,
    }));

    if (!silent) alert("Draft saved.");
    return result;
  };

  const handleCloseCompose = async () => {
    if (sending) return;

    if (!hasDraftableComposeContent()) {
      setComposeOpen(false);
      setActiveRecipientField("");
      return;
    }

    setSavingDraft(true);
    try {
      await saveCurrentDraft({ silent: true });
      setComposeOpen(false);
      setActiveRecipientField("");
    } catch (closeErr) {
      alert(friendlyAuthError(closeErr) || "Failed to save draft");
    } finally {
      setSavingDraft(false);
    }
  };

  const handleEditorInput = () => {
    ensureEditorImageWrappers();
    if (selectedInlineImageId && composeEditorRef.current) {
      const stillExists = Array.from(composeEditorRef.current.querySelectorAll("img")).some(
        (img) => img.getAttribute("data-inline-id") === selectedInlineImageId
      );
      if (!stillExists) setSelectedInlineImageId("");
    }
    const html = composeEditorRef.current?.innerHTML || "";
    setCompose((prev) => ({
      ...prev,
      bodyHtml: html,
      body: htmlToPlainText(html),
    }));
  };

  const handleAttachFiles = async (event) => {
    const files = Array.from(event.target.files || []);
    event.target.value = "";
    if (!uid || !files.length) return;
    await uploadComposeFiles(files, { appendToAttachments: true });
  };

  const handleBodyPaste = async (event) => {
    const clipboardItems = Array.from(event.clipboardData?.items || []);
    if (!clipboardItems.length) return;

    const imageFiles = clipboardItems
      .filter((item) => item.kind === "file" && String(item.type || "").startsWith("image/"))
      .map((item) => item.getAsFile())
      .filter(Boolean)
      .map((file) => {
        if (file.name) return file;
        const ext = String(file.type || "image/png").split("/")[1] || "png";
        return new File([file], `pasted-image-${Date.now()}.${ext}`, { type: file.type || "image/png" });
      });

    if (!imageFiles.length) return;

    // Prevent browsers from inserting plain filename text into editor.
    event.preventDefault();
    const pasteBatch = imageFiles.map((file, index) => {
      const token = `inline-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 8)}`;
      const localUrl = URL.createObjectURL(file);
      return { file, token, localUrl };
    });

    pasteBatch.forEach(({ file, token, localUrl }) => {
      insertHtmlAtCursor(buildResizableImageMarkup({
        src: localUrl,
        alt: file.name || "image",
        token,
        uploadState: "pending",
      }));
    });
    handleEditorInput();

    const uploadPromise = (async () => {
      try {
        const uploaded = await uploadComposeFiles(
          pasteBatch.map((x) => x.file),
          { appendToAttachments: false }
        );

        uploaded.forEach((uploadedFile, index) => {
          const token = pasteBatch[index]?.token;
          const localUrl = pasteBatch[index]?.localUrl;
          if (!token) return;

          const img = composeEditorRef.current?.querySelector(`img[data-upload-token="${token}"]`);
          if (!img) {
            if (localUrl) URL.revokeObjectURL(localUrl);
            return;
          }

          if (uploadedFile?.url) {
            img.setAttribute("src", uploadedFile.url);
            img.setAttribute("data-inline-upload", "done");
            img.removeAttribute("data-upload-token");
          } else {
            img.setAttribute("data-inline-upload", "failed");
            img.style.outline = "2px solid #ef4444";
            img.title = "Image upload failed. Please remove and paste again.";
          }

          if (localUrl) URL.revokeObjectURL(localUrl);
        });

        pasteBatch.slice(uploaded.length).forEach(({ token, localUrl }) => {
          const img = composeEditorRef.current?.querySelector(`img[data-upload-token="${token}"]`);
          if (img) {
            img.setAttribute("data-inline-upload", "failed");
            img.style.outline = "2px solid #ef4444";
            img.title = "Image upload failed. Please remove and paste again.";
          }
          if (localUrl) URL.revokeObjectURL(localUrl);
        });
      } catch {
        pasteBatch.forEach(({ token, localUrl }) => {
          const img = composeEditorRef.current?.querySelector(`img[data-upload-token="${token}"]`);
          if (img) {
            img.setAttribute("data-inline-upload", "failed");
            img.style.outline = "2px solid #ef4444";
            img.title = "Image upload failed. Please remove and paste again.";
          }
          if (localUrl) URL.revokeObjectURL(localUrl);
        });
      } finally {
        handleEditorInput();
      }
    })();

    trackInlineUpload(uploadPromise);
  };

  const handleEditorClick = (event) => {
    const editor = composeEditorRef.current;
    if (!editor) return;

    const clickedImage = event.target instanceof Element ? event.target.closest("img") : null;
    if (!clickedImage || !editor.contains(clickedImage)) {
      setSelectedInlineImageId("");
      return;
    }

    const inlineId = clickedImage.getAttribute("data-inline-id") || makeInlineImageId();
    clickedImage.setAttribute("data-inline-id", inlineId);
    setSelectedInlineImageId(inlineId);
  };

  const removeSelectedInlineImage = () => {
    const editor = composeEditorRef.current;
    if (!editor || !selectedInlineImageId) return;

    const target = Array.from(editor.querySelectorAll("img")).find(
      (img) => img.getAttribute("data-inline-id") === selectedInlineImageId
    );
    if (!target) {
      setSelectedInlineImageId("");
      return;
    }

    const blobSrc = String(target.getAttribute("src") || "");
    const wrapper = target.closest(`.${INLINE_IMAGE_WRAP_CLASS}`);
    (wrapper || target).remove();

    if (blobSrc.startsWith("blob:")) {
      try {
        URL.revokeObjectURL(blobSrc);
      } catch {
        // no-op
      }
    }

    setSelectedInlineImageId("");
    handleEditorInput();
  };

  const removeAttachment = (index) => {
    setCompose((prev) => ({
      ...prev,
      attachments: (prev.attachments || []).filter((_, i) => i !== index),
    }));
  };

  const handleSaveDraft = async () => {
    setSavingDraft(true);
    try {
      await saveCurrentDraft({ silent: false });
    } catch (draftErr) {
      alert(friendlyAuthError(draftErr) || "Failed to save draft");
    } finally {
      setSavingDraft(false);
    }
  };

  const handleSend = async () => {
    if (!uid) return;
    if (!compose.to.trim()) {
      alert("Please add at least one recipient.");
      return;
    }

    const allRecipients = [
      ...splitRecipientValues(compose.to),
      ...splitRecipientValues(compose.cc),
      ...splitRecipientValues(compose.bcc),
    ];

    const unknownInternalRecipients = Array.from(
      new Set(
        allRecipients.filter(
          (email) => email.endsWith("@kapilpower.com") && !knownDirectoryEmails.has(email)
        )
      )
    );

    if (unknownInternalRecipients.length) {
      const proceed = window.confirm(
        `These @kapilpower.com addresses are not found in CRM directory and may bounce:\n\n${unknownInternalRecipients.join(
          "\n"
        )}\n\nSend anyway?`
      );
      if (!proceed) return;
    }

    setSending(true);
    try {
      await waitForInlineUploads();
      handleEditorInput();
      if (hasUnresolvedInlineImages()) {
        alert("Some pasted images are still uploading or failed. Please wait, then retry send.");
        return;
      }

      const sendResult = await sendMailApi({
        to: trimRecipients(compose.to),
        cc: trimRecipients(compose.cc),
        bcc: trimRecipients(compose.bcc),
        subject: compose.subject,
        body: compose.body,
        bodyHtml: compose.bodyHtml || "",
        attachments: compose.attachments || [],
      });

      if (compose.draftId) {
        await deleteDoc(doc(db, "mailboxes", uid, "messages", compose.draftId));
      }

      setComposeOpen(false);
      setActiveRecipientField("");
      setCompose({ draftId: "", to: "", cc: "", bcc: "", subject: "", body: "", bodyHtml: "", attachments: [] });

      if (sendResult?.smtpDelivered === false) {
        const smtpIssue = sendResult?.smtpError || "SMTP delivery failed";
        const rejected = Array.isArray(sendResult?.smtpRejected) ? sendResult.smtpRejected.filter(Boolean) : [];
        const rejectedText = rejected.length ? `\nRejected: ${rejected.join(", ")}` : "";
        alert(`Mail saved in CRM, but external email delivery failed.\n\n${smtpIssue}${rejectedText}`);
        return;
      }

      alert("Mail sent.");
    } catch (sendErr) {
      alert(friendlyAuthError(sendErr) || "Failed to send mail");
    } finally {
      setSending(false);
    }
  };

  const renderRecipientInput = (field, placeholder) => (
    <div style={{ position: "relative" }}>
      <input
        value={compose[field]}
        onFocus={() => setActiveRecipientField(field)}
        onBlur={() => setTimeout(() => setActiveRecipientField(""), 120)}
        onChange={(e) => {
          setActiveRecipientField(field);
          setComposeField(field, e.target.value);
        }}
        placeholder={placeholder}
        style={{ border: "1px solid #d8c7db", borderRadius: 9, padding: "9px 10px", width: "100%", boxSizing: "border-box" }}
      />
      {activeRecipientField === field && recipientSuggestions.length > 0 && (
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: "calc(100% + 4px)",
            background: isMobile ? "#141a29" : "#fff",
            border: isMobile ? "1px solid #323a52" : "1px solid #ddd0df",
            borderRadius: 10,
            boxShadow: "0 10px 24px rgba(0,0,0,0.14)",
            zIndex: 1000000,
            maxHeight: 220,
            overflowY: "auto",
          }}
        >
          {recipientSuggestions.map((u) => (
            <button
              key={`${field}-${u.id}`}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => applyRecipientSuggestion(field, u.email)}
              style={{
                width: "100%",
                textAlign: "left",
                border: 0,
                background: isMobile ? "#141a29" : "#fff",
                cursor: "pointer",
                padding: "8px 10px",
                borderBottom: isMobile ? "1px solid #252d44" : "1px solid #f2ebf3",
              }}
            >
              <div style={{ fontWeight: 700, color: isMobile ? "#eef2ff" : "#2f2a2f", fontSize: 14 }}>{u.email}</div>
              <div style={{ color: isMobile ? "#a7b1d3" : "#766a77", fontSize: 12 }}>{u.name || "Kapil Power user"}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <div
      style={{
        width: "100%",
        margin: "0 auto",
        padding: "6px 2px 10px",
        background: isMobile ? "#07090f" : "transparent",
        height: "100dvh",
        boxSizing: "border-box",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div
        style={{
          background: isMobile ? "linear-gradient(90deg, #6e0b19 0%, #4f126a 100%)" : "linear-gradient(90deg, #8f1123 0%, #5e167a 100%)",
          color: "#fff",
          borderRadius: isMobile ? 16 : 12,
          padding: "8px 12px",
          marginBottom: 8,
          boxShadow: "0 8px 18px rgba(70, 10, 50, 0.28)",
          border: "1px solid rgba(255,255,255,0.15)",
          display: "flex",
          alignItems: "center",
          gap: 10,
        }}
      >
        <button
          type="button"
          onClick={() => navigate(-1)}
          style={{
            border: "1px solid rgba(255,255,255,0.45)",
            color: "#fff",
            background: "rgba(255,255,255,0.1)",
            borderRadius: 8,
            padding: "6px 10px",
            cursor: "pointer",
            fontWeight: 700,
          }}
        >
          ← Back
        </button>
        <h2 style={{ margin: 0, fontSize: isMobile ? 26 : 30, fontWeight: 800, letterSpacing: 0.2 }}>Mail Center</h2>
      </div>

      <div
        style={{
          background: isMobile ? "#0f121a" : "#fff",
          borderRadius: isMobile ? 18 : 14,
          border: isMobile ? "1px solid #232838" : "1px solid #eadfeb",
          boxShadow: isMobile ? "0 12px 28px rgba(0,0,0,0.35)" : "0 8px 22px rgba(0,0,0,0.08)",
          padding: 12,
          flex: 1,
          minHeight: 0,
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search mail"
              style={{ border: isMobile ? "1px solid #2e3447" : "1px solid #dbcfe0", borderRadius: 20, padding: "8px 12px", minWidth: 220, background: isMobile ? "#121724" : "#fff", color: isMobile ? "#f4f7ff" : "#1b1b1b" }}
            />
            <button
              type="button"
              onClick={openCompose}
              style={{ border: 0, borderRadius: 10, padding: "9px 12px", color: "#fff", background: "linear-gradient(135deg,#8f1123,#5e167a)", fontWeight: 700, cursor: "pointer" }}
            >
              Compose
            </button>
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
          {folders.map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFolder(f)}
              style={{
                borderRadius: 999,
                border: folder === f ? "1px solid #8f1123" : isMobile ? "1px solid #30364a" : "1px solid #d9cddc",
                background: folder === f ? (isMobile ? "#2a1025" : "#fcecef") : isMobile ? "#111725" : "#fff",
                color: folder === f ? "#ff8ea8" : isMobile ? "#d9e1ff" : "#3f3340",
                padding: "7px 12px",
                fontWeight: 700,
                textTransform: "capitalize",
                cursor: "pointer",
              }}
            >
              {f} ({messages.filter((m) => m.folder === f).length})
            </button>
          ))}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: isNarrow ? "1fr" : "360px 1fr", gap: 10, flex: 1, minHeight: 0, overflow: "hidden" }}>
          <div style={{ border: isMobile ? "1px solid #272d3f" : "1px solid #ebdfed", borderRadius: 12, maxHeight: isNarrow ? 300 : "100%", overflowY: "auto", overflowX: "hidden", minHeight: 0, background: isMobile ? "#0f141f" : "#fff" }}>
            {loading && <p style={{ padding: 12, margin: 0, color: isMobile ? "#cfd7f5" : "#1d1d1d" }}>Loading...</p>}
            {!loading && !filtered.length && <p style={{ padding: 12, margin: 0, color: isMobile ? "#cfd7f5" : "#1d1d1d" }}>No messages in {folder}.</p>}
            {!loading && filtered.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => {
                  setSelectedId(m.id);
                  if (m.folder === "inbox" && !m.isRead) {
                    updateMessage(m.id, { isRead: true, readAt: new Date() }).catch(() => {});
                  }
                }}
                style={{
                  width: "100%",
                  textAlign: "left",
                  border: 0,
                  borderBottom: isMobile ? "1px solid #20283a" : "1px solid #f2eaf3",
                  background: selected?.id === m.id ? (isMobile ? "#1a2030" : "#fdf6f8") : isMobile ? "#0f141f" : "#fff",
                  padding: "10px 12px",
                  cursor: "pointer",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", gap: 6 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                    {m.folder === "inbox" && !m.isRead && <span style={{ width: 8, height: 8, borderRadius: 999, background: "#2aa5ff", flexShrink: 0 }} />}
                    <strong style={{ color: m.isRead ? (isMobile ? "#d9dff2" : "#3a3a3a") : (isMobile ? "#ffffff" : "#760f20"), whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {m.folder === "sent" ? (m.toEmails || []).join(", ") || "(no recipient)" : (m.fromName || m.fromEmail || "Unknown")}
                    </strong>
                  </div>
                  <span style={{ color: "#888", fontSize: 12 }}>{fmtDate(m.updatedAt || m.sentAt)}</span>
                </div>
                <div style={{ fontWeight: m.isRead ? 500 : 700, color: isMobile ? "#f3f5ff" : "#222", marginTop: 4 }}>{m.subject || "(No subject)"}</div>
                <div style={{ color: isMobile ? "#9ea8c9" : "#666", marginTop: 2, fontSize: 13, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {m.preview || "(empty)"}
                </div>
              </button>
            ))}
          </div>

          <div style={{ border: isMobile ? "1px solid #272d3f" : "1px solid #ebdfed", borderRadius: 12, padding: 12, minHeight: isNarrow ? 280 : 0, overflowY: "auto", overflowX: "hidden", background: isMobile ? "#0f141f" : "#fff" }}>
            {!selected && <p style={{ margin: 0, color: isMobile ? "#d8def4" : "#1f1f1f" }}>Select a mail to view details.</p>}
            {selected && (
              <>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", gap: 10, flexWrap: "wrap" }}>
                  <div>
                    <h3 style={{ margin: "0 0 8px", color: isMobile ? "#f4f7ff" : "#5d0e20" }}>{selected.subject || "(No subject)"}</h3>
                    <div style={{ color: isMobile ? "#b9c2df" : "#555", fontSize: 13 }}>
                      <div><b>From:</b> {selected.fromName || ""} {selected.fromEmail ? `<${selected.fromEmail}>` : ""}</div>
                      <div><b>To:</b> {(selected.toEmails || []).join(", ") || "-"}</div>
                      {!!(selected.ccEmails || []).length && <div><b>CC:</b> {(selected.ccEmails || []).join(", ")}</div>}
                      <div><b>Date:</b> {fmtDate(selected.sentAt || selected.updatedAt)}</div>
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {selected.folder === "draft" && (
                      <button type="button" onClick={() => openDraft(selected)} style={{ borderRadius: 8, border: "1px solid #d8c7dd", background: "#fff", padding: "7px 10px", cursor: "pointer" }}>Edit draft</button>
                    )}
                    {selected.folder !== "draft" && (
                      <button type="button" onClick={() => openReply(selected)} style={{ borderRadius: 8, border: "1px solid #d8c7dd", background: "#fff", padding: "7px 10px", cursor: "pointer" }}>Reply</button>
                    )}
                    <button type="button" disabled={actionBusyId === selected.id} onClick={() => updateMessage(selected.id, { isStarred: !selected.isStarred })} style={{ borderRadius: 8, border: "1px solid #d8c7dd", background: selected.isStarred ? "#fff6dc" : "#fff", padding: "7px 10px", cursor: "pointer" }}>{selected.isStarred ? "★ Starred" : "☆ Star"}</button>
                    {selected.folder === "trash" ? (
                      <>
                        <button type="button" disabled={actionBusyId === selected.id} onClick={() => restoreMail(selected)} style={{ borderRadius: 8, border: "1px solid #d8c7dd", background: "#fff", padding: "7px 10px", cursor: "pointer" }}>Restore</button>
                        <button type="button" onClick={() => deleteForever(selected)} style={{ borderRadius: 8, border: "1px solid #e4bec6", color: "#8a1021", background: "#fff", padding: "7px 10px", cursor: "pointer" }}>Delete forever</button>
                      </>
                    ) : (
                      <button type="button" disabled={actionBusyId === selected.id} onClick={() => moveToTrash(selected)} style={{ borderRadius: 8, border: "1px solid #e4bec6", color: "#8a1021", background: "#fff", padding: "7px 10px", cursor: "pointer" }}>Move to trash</button>
                    )}
                    {selected.folder === "inbox" && (
                      <button type="button" disabled={actionBusyId === selected.id} onClick={() => updateMessage(selected.id, { isRead: !selected.isRead, readAt: !selected.isRead ? new Date() : null })} style={{ borderRadius: 8, border: "1px solid #d8c7dd", background: "#fff", padding: "7px 10px", cursor: "pointer" }}>{selected.isRead ? "Mark unread" : "Mark read"}</button>
                    )}
                  </div>
                </div>

                {selected.bodyHtml ? (
                  <div
                    style={{ marginTop: 14, lineHeight: 1.6, color: isMobile ? "#eef2ff" : "#242424" }}
                    dangerouslySetInnerHTML={{ __html: selected.bodyHtml }}
                  />
                ) : (
                  <div style={{ marginTop: 14, whiteSpace: "pre-wrap", lineHeight: 1.6, color: isMobile ? "#eef2ff" : "#242424" }}>
                    {selected.body || "(No message content)"}
                  </div>
                )}

                {!!(selected.attachments || []).length && (
                  <div style={{ marginTop: 12 }}>
                    <div style={{ fontWeight: 700, color: "#5d0e20", marginBottom: 6 }}>
                      Attachments ({selected.attachments.length})
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      {(selected.attachments || []).map((file, i) => (
                        <a
                          key={`${selected.id}-att-${i}`}
                          href={file.url}
                          target="_blank"
                          rel="noreferrer"
                          style={{ color: "#5e167a", textDecoration: "underline", fontSize: 13 }}
                        >
                          {file.name || "attachment"} {file.size ? `(${formatBytes(file.size)})` : ""}
                        </a>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
        {error && <p style={{ color: "#a1172d", marginTop: 10 }}>{error}</p>}
      </div>

      <p style={{ marginTop: 8, fontSize: 12, color: isMobile ? "#9aa5cc" : "#666" }}>
        Signed in as: {currentEmail || "(unknown user)"}
      </p>

      {composeOpen && (
        <div
          onClick={handleCloseCompose}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", zIndex: 999999, display: "flex", justifyContent: "center", alignItems: "center", padding: 12 }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ width: "min(760px, 100%)", background: isMobile ? "#0f141f" : "#fff", borderRadius: 14, padding: 14, boxShadow: "0 12px 34px rgba(0,0,0,0.25)", border: isMobile ? "1px solid #2a3147" : "none" }}
          >
            <h3 style={{ margin: "0 0 8px", color: isMobile ? "#f4f7ff" : "#6f0f29" }}>{compose.draftId ? "Edit Draft" : "Compose Mail"}</h3>
            <div style={{ display: "grid", gap: 8 }}>
              {renderRecipientInput("to", "To (comma separated)")}
              {renderRecipientInput("cc", "CC (optional)")}
              {renderRecipientInput("bcc", "BCC (optional)")}
              <input value={compose.subject} onChange={(e) => setComposeField("subject", e.target.value)} placeholder="Subject" style={{ border: isMobile ? "1px solid #323a52" : "1px solid #d8c7db", background: isMobile ? "#131928" : "#fff", color: isMobile ? "#eef2ff" : "#222", borderRadius: 9, padding: "9px 10px" }} />
              <div
                ref={composeEditorRef}
                contentEditable
                suppressContentEditableWarning
                onInput={handleEditorInput}
                onPaste={handleBodyPaste}
                onClick={handleEditorClick}
                style={{
                  border: isMobile ? "1px solid #323a52" : "1px solid #d8c7db",
                  background: isMobile ? "#131928" : "#fff",
                  color: isMobile ? "#eef2ff" : "#222",
                  borderRadius: 9,
                  padding: "10px",
                  minHeight: 220,
                  maxHeight: 420,
                  overflowY: "auto",
                  outline: "none",
                }}
                data-placeholder="Message (paste images anywhere inside body)"
              />

              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
                  {selectedInlineImageId && (
                    <button
                      type="button"
                      onClick={removeSelectedInlineImage}
                      style={{ border: "1px solid #e4bec6", color: "#8a1021", background: "#fff", borderRadius: 8, padding: "6px 10px", cursor: "pointer", fontWeight: 700 }}
                    >
                      Remove selected image
                    </button>
                  )}
                  <span style={{ fontSize: 12, color: isMobile ? "#a7b1d3" : "#6b7280" }}>
                    Click an image in the message to remove it.
                  </span>
                </div>

                <label
                  htmlFor="mail-attachment-input"
                  style={{ display: "inline-block", border: "1px solid #d4c4d9", borderRadius: 8, padding: "7px 10px", cursor: "pointer", fontWeight: 600 }}
                >
                  {uploadingFiles ? "Uploading..." : "Attach files"}
                </label>
                {pendingInlineUploads > 0 && (
                  <span style={{ marginLeft: 8, fontSize: 12, color: isMobile ? "#a7b1d3" : "#6b7280" }}>
                    Pasted image syncing… ({pendingInlineUploads})
                  </span>
                )}
                <input
                  id="mail-attachment-input"
                  type="file"
                  multiple
                  onChange={handleAttachFiles}
                  style={{ display: "none" }}
                  disabled={uploadingFiles}
                />

                {!!(compose.attachments || []).length && (
                  <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
                    {(compose.attachments || []).map((file, index) => (
                      <div key={`compose-file-${index}`} style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", border: "1px solid #eadfeb", borderRadius: 8, padding: "6px 8px" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                          {isImageAttachment(file) && file.url ? (
                            <img
                              src={file.url}
                              alt={file.name || "pasted image"}
                              style={{ width: 52, height: 52, objectFit: "cover", borderRadius: 6, border: "1px solid #ddd" }}
                            />
                          ) : null}
                          <div style={{ fontSize: 13, color: isMobile ? "#eef2ff" : "#2f2a2f", overflow: "hidden", textOverflow: "ellipsis" }}>
                            {file.name || "attachment"} {file.size ? `(${formatBytes(file.size)})` : ""}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => removeAttachment(index)}
                          style={{ border: "1px solid #e4bec6", color: "#8a1021", background: "#fff", borderRadius: 6, padding: "4px 8px", cursor: "pointer" }}
                        >
                          Remove
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div style={{ marginTop: 10, display: "flex", justifyContent: "flex-end", gap: 8, flexWrap: "wrap" }}>
              <button type="button" onClick={handleCloseCompose} style={{ borderRadius: 8, border: "1px solid #d4c4d9", background: "#fff", padding: "8px 10px", cursor: "pointer" }}>{savingDraft ? "Saving..." : "Close"}</button>
              <button type="button" disabled={savingDraft} onClick={handleSaveDraft} style={{ borderRadius: 8, border: "1px solid #d4c4d9", background: "#fff", padding: "8px 10px", cursor: "pointer" }}>{savingDraft ? "Saving..." : "Save Draft"}</button>
              <button type="button" disabled={sending} onClick={handleSend} style={{ border: 0, borderRadius: 8, padding: "8px 12px", background: "linear-gradient(135deg,#8f1123,#5e167a)", color: "#fff", fontWeight: 700, cursor: "pointer" }}>{sending ? "Sending..." : "Send"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
