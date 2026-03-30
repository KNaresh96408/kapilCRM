import React, { useEffect, useMemo, useRef, useState } from "react";

const toTitleCase = (value) => {
  const txt = String(value || "").trim();
  if (!txt) return "Employee";
  return txt
    .replace(/[_-]+/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
};

const normalizeRoleKey = (value) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_")
    .replace(/_+/g, "_");

const getScopeLabel = (node) => {
  const roleKey = normalizeRoleKey(node?.role || node?.Role || node?.designation || "");
  const designationKey = normalizeRoleKey(node?.designation || "");
  const isTeamManager = designationKey.includes("team_manager");
  const isTeamLead = designationKey.includes("team_lead") || roleKey === "team_lead";
  const state = node?.state || node?.state_label || "";
  const zone = node?.sales_zone || node?.sales_zone_label || "";
  const area = node?.sales_area || node?.sales_area_label || "";

  if ((roleKey === "state_head" || isTeamLead) && !isTeamManager) {
    return state ? `State: ${state}` : "";
  }

  if (roleKey === "consultant" || roleKey === "area_sales_manager") {
    return area ? `Area: ${area}` : "";
  }

  if (roleKey === "zonal_manager" || roleKey === "telecaller" || roleKey === "tele_caller" || roleKey === "service_engineer") {
    return zone ? `Zone: ${zone}` : "";
  }

  return "";
};

function OrgNode({ node, selectedId, onSelect, expanded, registerSubtreeRef }) {
  const children = Array.isArray(node.children) ? node.children : [];
  const hasChildren = children.length > 0;
  const isExpanded = !!expanded[node.id];
  const isSelected = selectedId === node.id;

  const title = node.designation || toTitleCase(node.role);
  const name =
    node.name ||
    node.Name ||
    node.fullName ||
    node.displayName ||
    node.employeeName ||
    node.employee_name ||
    node.id;

  const scopeLabel = getScopeLabel(node);

  const avatarUrl =
    node.profilePhotoPreview ||
    node.profilePhotoUrl ||
    node.profilePhoto ||
    node.photoURL ||
    "";

  return (
    <div style={subtreeWrap} ref={(el) => registerSubtreeRef(node.id, el)}>
      <div style={nodeShell}>
        <button
          type="button"
          onClick={() => onSelect(node)}
          style={{
            ...nodeCard,
            ...(isSelected ? nodeCardSelected : {}),
          }}
          title={`${title} - ${name}`}
        >
          <div style={nodeRow}>
            <div style={{ ...nodeAvatarShell, ...(isSelected ? nodeAvatarShellSelected : {}) }}>
              {avatarUrl ? (
                <img src={avatarUrl} alt={name} style={nodeAvatarImg} />
              ) : (
                <span style={nodeAvatarFallback}>👤</span>
              )}
            </div>
            <div style={nodeTextWrap}>
              <div style={nodeTitle}>{title}</div>
              <div style={nodeName}>{name}</div>
              {scopeLabel ? <div style={nodeScope}>{scopeLabel}</div> : <div style={nodeScopePlaceholder} aria-hidden="true">&nbsp;</div>}
            </div>
          </div>
        </button>
      </div>

      {hasChildren && isExpanded && (
        <>
          <div style={verticalLine} />

          <div style={childrenWrap}>
            {children.map((child, index) => (
              <div key={child.id} style={childCell}>
                {children.length > 1 && (
                  <div
                    style={{
                      ...childTopLine,
                      ...(index === 0 ? childTopLineFirst : {}),
                      ...(index === children.length - 1 ? childTopLineLast : {}),
                    }}
                  />
                )}
                <div style={verticalLineTop} />
                <OrgNode
                  node={child}
                  selectedId={selectedId}
                  onSelect={onSelect}
                  expanded={expanded}
                  registerSubtreeRef={registerSubtreeRef}
                />
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export default function OrganizationTree({ treeData = [], onSelectNode }) {
  const [selectedId, setSelectedId] = useState("");
  const [expanded, setExpanded] = useState({});
  const [isDragging, setIsDragging] = useState(false);
  const viewportRef = useRef(null);
  const subtreeRefs = useRef(new Map());
  const suppressClickRef = useRef(false);
  const dragRef = useRef({
    startX: 0,
    startY: 0,
    scrollLeft: 0,
    scrollTop: 0,
    moved: false,
  });

  const roots = useMemo(() => (Array.isArray(treeData) ? treeData : []), [treeData]);

  const relations = useMemo(() => {
    const parentById = new Map();
    const childrenById = new Map();

    const walk = (node, parentId = "") => {
      const id = node?.id;
      if (!id) return;
      if (parentId) parentById.set(id, parentId);

      const kids = Array.isArray(node.children) ? node.children : [];
      const childIds = kids.map((k) => k?.id).filter(Boolean);
      childrenById.set(id, childIds);

      kids.forEach((k) => walk(k, id));
    };

    roots.forEach((r) => walk(r));
    return { parentById, childrenById };
  }, [roots]);

  const getAncestorPath = (id) => {
    const path = [];
    let cur = id;
    const seen = new Set();

    while (cur && !seen.has(cur)) {
      seen.add(cur);
      path.push(cur);
      cur = relations.parentById.get(cur) || "";
    }

    return path.reverse();
  };

  const getDescendants = (id) => {
    const out = [];
    const stack = [...(relations.childrenById.get(id) || [])];
    const seen = new Set();

    while (stack.length) {
      const cur = stack.pop();
      if (!cur || seen.has(cur)) continue;
      seen.add(cur);
      out.push(cur);
      (relations.childrenById.get(cur) || []).forEach((k) => stack.push(k));
    }

    return out;
  };

  const registerSubtreeRef = (id, el) => {
    if (!id) return;
    if (el) subtreeRefs.current.set(id, el);
    else subtreeRefs.current.delete(id);
  };

  const onToggleExpand = (id) => {
    if (!id) return;

    setExpanded((prev) => {
      const isOpen = !!prev[id];

      if (isOpen) {
        const next = { ...prev };
        [id, ...getDescendants(id)].forEach((k) => {
          delete next[k];
        });
        return next;
      }

      const next = {};
      getAncestorPath(id).forEach((k) => {
        next[k] = true;
      });
      return next;
    });
  };

  const handleSelect = (node) => {
    if (suppressClickRef.current) return;

    const id = node?.id || "";
    setSelectedId(id);
    if (id && Array.isArray(node?.children) && node.children.length > 0) {
      onToggleExpand(id);
    }
    if (typeof onSelectNode === "function") onSelectNode(node);
  };

  useEffect(() => {
    if (!selectedId) return;

    const viewport = viewportRef.current;
    const selectedSubtree = subtreeRefs.current.get(selectedId);
    if (!viewport || !selectedSubtree) return;

    const viewRect = viewport.getBoundingClientRect();
    const branchRect = selectedSubtree.getBoundingClientRect();

    let nextLeft = viewport.scrollLeft;
    if (branchRect.left < viewRect.left) nextLeft += branchRect.left - viewRect.left - 24;
    if (branchRect.right > viewRect.right) nextLeft += branchRect.right - viewRect.right + 24;

    if (nextLeft !== viewport.scrollLeft) {
      viewport.scrollTo({ left: Math.max(0, nextLeft), behavior: "smooth" });
    }
  }, [selectedId, expanded]);

  const onViewportMouseDown = (e) => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      scrollLeft: viewport.scrollLeft,
      scrollTop: viewport.scrollTop,
      moved: false,
    };
    setIsDragging(true);
  };

  const onViewportMouseMove = (e) => {
    if (!isDragging) return;
    const viewport = viewportRef.current;
    if (!viewport) return;

    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;

    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
      dragRef.current.moved = true;
    }

    viewport.scrollLeft = dragRef.current.scrollLeft - dx;
    viewport.scrollTop = dragRef.current.scrollTop - dy;
  };

  const onViewportMouseUp = () => {
    if (!isDragging) return;
    suppressClickRef.current = dragRef.current.moved;
    setIsDragging(false);
    window.setTimeout(() => {
      suppressClickRef.current = false;
    }, 0);
  };

  const onViewportMouseLeave = () => {
    if (!isDragging) return;
    suppressClickRef.current = dragRef.current.moved;
    setIsDragging(false);
    window.setTimeout(() => {
      suppressClickRef.current = false;
    }, 0);
  };

  return (
    <div>
      <style>{orgTreeScrollbarStyle}</style>
      <div
        className="org-tree-viewport"
        style={{
          ...treeViewport,
          cursor: isDragging ? "grabbing" : "grab",
          userSelect: isDragging ? "none" : "auto",
        }}
        ref={viewportRef}
        onMouseDown={onViewportMouseDown}
        onMouseMove={onViewportMouseMove}
        onMouseUp={onViewportMouseUp}
        onMouseLeave={onViewportMouseLeave}
      >
        {!roots.length && <div style={{ padding: 8, color: "#666" }}>No users found.</div>}

        {!!roots.length && (
          <div style={rootsWrap}>
            {roots.map((root) => (
              <OrgNode
                key={root.id}
                node={root}
                selectedId={selectedId}
                onSelect={handleSelect}
                expanded={expanded}
                registerSubtreeRef={registerSubtreeRef}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

const orgTreeScrollbarStyle = `
.org-tree-viewport {
  scrollbar-width: none;
  -ms-overflow-style: none;
}
.org-tree-viewport::-webkit-scrollbar {
  width: 0;
  height: 0;
}
`;

const treeViewport = {
  background: "#ececec",
  border: "1px solid #d6d6d6",
  borderRadius: 0,
  padding: "18px 14px",
  overflowX: "auto",
  overflowY: "auto",
  minHeight: "72vh",
  width: "100%",
  maxWidth: "100%",
  boxSizing: "border-box",
};

const rootsWrap = {
  display: "flex",
  justifyContent: "center",
  alignItems: "flex-start",
  gap: 36,
  minWidth: "max-content",
};

const subtreeWrap = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  minWidth: "max-content",
};

const nodeShell = {
  display: "flex",
  alignItems: "center",
  gap: 8,
};

const nodeCard = {
  border: "1px solid rgba(128,0,0,0.35)",
  background: "linear-gradient(135deg, #8b0000 0%, #a11212 60%, #b31b1b 100%)",
  color: "#fff",
  width: 260,
  height: 92,
  padding: "10px 12px",
  fontWeight: 700,
  borderRadius: 10,
  cursor: "pointer",
  lineHeight: 1.25,
  textAlign: "left",
  overflow: "hidden",
  boxShadow: "0 10px 18px rgba(139,0,0,0.22)",
  transition: "transform 0.18s ease, box-shadow 0.18s ease, background 0.18s ease",
};

const nodeCardSelected = {
  background: "#fff",
  color: "#7b0a0a",
  boxShadow: "0 0 0 2px rgba(139,0,0,0.25), 0 14px 24px rgba(0,0,0,0.18)",
  transform: "translateY(-2px)",
};

const nodeTitle = {
  fontSize: 11,
  fontWeight: 800,
  letterSpacing: 0.4,
  textTransform: "uppercase",
  opacity: 0.85,
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
};

const nodeName = {
  marginTop: 4,
  fontSize: 14,
  fontWeight: 900,
  lineHeight: 1.2,
  overflow: "hidden",
  textOverflow: "ellipsis",
  display: "-webkit-box",
  WebkitLineClamp: 2,
  WebkitBoxOrient: "vertical",
  wordBreak: "break-word",
};

const nodeScope = {
  marginTop: 6,
  fontSize: 11,
  fontWeight: 700,
  opacity: 0.95,
  background: "rgba(255,255,255,0.22)",
  padding: "2px 8px",
  borderRadius: 999,
  display: "block",
  width: "100%",
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
  boxSizing: "border-box",
};

const nodeScopePlaceholder = {
  marginTop: 6,
  fontSize: 11,
  fontWeight: 700,
  padding: "2px 8px",
  borderRadius: 999,
  display: "block",
  width: "100%",
  boxSizing: "border-box",
  visibility: "hidden",
};

const nodeRow = {
  display: "flex",
  alignItems: "center",
  gap: 8,
};

const nodeAvatarShell = {
  width: 34,
  height: 34,
  borderRadius: "50%",
  background: "rgba(255,255,255,0.9)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  overflow: "hidden",
  flexShrink: 0,
  border: "1px solid rgba(255,255,255,0.6)",
  boxShadow: "0 2px 6px rgba(0,0,0,0.2)",
  transition: "transform 0.18s ease, box-shadow 0.18s ease",
};

const nodeAvatarImg = {
  width: "100%",
  height: "100%",
  objectFit: "cover",
};

const nodeAvatarFallback = {
  fontSize: 18,
  color: "#7a0f1a",
};

const nodeTextWrap = {
  display: "flex",
  flexDirection: "column",
  minWidth: 0,
  width: "100%",
};

const nodeAvatarShellSelected = {
  transform: "scale(1.08)",
  boxShadow: "0 0 0 2px rgba(139,0,0,0.35)",
};

const verticalLine = {
  width: 2,
  height: 24,
  background: "#8b0000",
};

const childrenWrap = {
  display: "flex",
  alignItems: "flex-start",
  justifyContent: "center",
  gap: 16,
  paddingTop: 20,
};

const childCell = {
  position: "relative",
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  paddingTop: 2,
};

const verticalLineTop = {
  position: "absolute",
  top: -18,
  width: 2,
  height: 18,
  background: "#8b0000",
};

const childTopLine = {
  position: "absolute",
  top: -18,
  left: 0,
  right: 0,
  height: 2,
  background: "#8b0000",
};

const childTopLineFirst = {
  left: "50%",
};

const childTopLineLast = {
  right: "50%",
};
