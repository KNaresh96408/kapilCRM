import React, { useEffect, useMemo, useRef, useState } from "react";

const defaultGetOptionLabel = (opt) =>
  String(opt?.label ?? opt?.name ?? opt?.email ?? opt?.value ?? "");

const defaultGetOptionValue = (opt) => String(opt?.value ?? opt?.id ?? opt?.email ?? opt?.name ?? "");

export default function SearchableSelect({
  options = [],
  value = "",
  onChange,
  placeholder = "Search...",
  getOptionLabel = defaultGetOptionLabel,
  getOptionValue = defaultGetOptionValue,
  getOptionSearchText,
  disabled = false,
  allowClear = false,
  noResultsText = "No matches found",
  dropdownMaxHeight = 220,
  showResultCount = false,
}) {
  const rootRef = useRef(null);
  const prevValueRef = useRef(String(value || ""));
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const selected = useMemo(
    () => (options || []).find((opt) => getOptionValue(opt) === String(value || "")) || null,
    [options, value, getOptionValue]
  );

  useEffect(() => {
    const valueKey = String(value || "");
    if (prevValueRef.current === valueKey) return;
    prevValueRef.current = valueKey;

    if (!valueKey) {
      setQuery("");
      return;
    }

    if (selected) {
      setQuery(getOptionLabel(selected));
      return;
    }

    setQuery(valueKey);
  }, [selected, value, getOptionLabel]);

  useEffect(() => {
    const handleOutside = (e) => {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(e.target)) {
        setOpen(false);
        if (selected) setQuery(getOptionLabel(selected));
      }
    };
    document.addEventListener("mousedown", handleOutside);
    document.addEventListener("touchstart", handleOutside, { passive: true });
    return () => {
      document.removeEventListener("mousedown", handleOutside);
      document.removeEventListener("touchstart", handleOutside);
    };
  }, [selected, getOptionLabel]);

  const filtered = useMemo(() => {
    const q = String(query || "").trim().toLowerCase();
    if (!q) return options;
    return (options || []).filter((opt) => {
      const label = getOptionLabel(opt).toLowerCase();
      const extra = String(
        typeof getOptionSearchText === "function"
          ? getOptionSearchText(opt)
          : `${opt?.name || ""} ${opt?.email || ""} ${opt?.label || ""}`
      ).toLowerCase();
      return label.includes(q) || extra.includes(q);
    });
  }, [options, query, getOptionLabel, getOptionSearchText]);

  const pick = (opt) => {
    const val = getOptionValue(opt);
    setQuery(getOptionLabel(opt));
    setOpen(false);
    if (typeof onChange === "function") onChange(val, opt);
  };

  return (
    <div ref={rootRef} style={{ position: "relative", width: "100%" }}>
      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <input
          type="text"
          value={query}
          disabled={disabled}
          placeholder={placeholder}
          onFocus={() => !disabled && setOpen(true)}
          onChange={(e) => {
            const nextQuery = e.target.value;
            const selectedLabel = selected ? getOptionLabel(selected) : "";
            setQuery(nextQuery);

            if (selected && String(value || "") && nextQuery !== selectedLabel) {
              if (typeof onChange === "function") onChange("");
            }

            if (!open) setOpen(true);
          }}
          style={{
            width: "100%",
            padding: "8px 10px",
            borderRadius: 8,
            border: "1px solid rgba(128,0,0,0.35)",
            fontSize: 13,
            boxSizing: "border-box",
            background: disabled ? "#f6f6f6" : "#fff",
            color: "#111827",
          }}
        />

        {allowClear && !disabled && value ? (
          <button
            type="button"
            onClick={() => {
              setQuery("");
              setOpen(false);
              if (typeof onChange === "function") onChange("");
            }}
            style={{
              border: "1px solid rgba(128,0,0,0.35)",
              background: "#fff",
              color: "#800000",
              borderRadius: 8,
              padding: "6px 10px",
              cursor: "pointer",
              fontWeight: 600,
              fontSize: 12,
            }}
          >
            Clear
          </button>
        ) : null}
      </div>

      {open && !disabled && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            left: 0,
            right: 0,
            maxHeight: dropdownMaxHeight,
            overflowY: "auto",
            border: "1px solid rgba(128,0,0,0.25)",
            borderRadius: 8,
            background: "#fff",
            boxShadow: "0 12px 28px rgba(0,0,0,0.12)",
            zIndex: 1000,
          }}
        >
          {showResultCount ? (
            <div
              style={{
                position: "sticky",
                top: 0,
                zIndex: 1,
                background: "#f9fafb",
                borderBottom: "1px solid #e5e7eb",
                padding: "7px 10px",
                fontSize: 12,
                fontWeight: 700,
                color: "#6b7280",
              }}
            >
              Showing {filtered.length} of {(options || []).length} users
            </div>
          ) : null}
          {filtered.length === 0 ? (
            <div style={{ padding: 10, color: "#6b7280", fontSize: 13 }}>{noResultsText}</div>
          ) : (
            filtered.map((opt) => {
              const optionValue = getOptionValue(opt);
              const active = String(value || "") === optionValue;
              return (
                <button
                  type="button"
                  key={optionValue}
                  onClick={() => pick(opt)}
                  style={{
                    width: "100%",
                    textAlign: "left",
                    border: "none",
                    borderBottom: "1px solid #f3f4f6",
                    background: active ? "#fff7f7" : "#fff",
                    color: "#111827",
                    cursor: "pointer",
                    padding: "8px 12px",
                    fontSize: 13,
                  }}
                >
                  {getOptionLabel(opt)}
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
