// src/components/ExportAttendanceModal.jsx
import React, { useEffect, useState } from "react";
import * as XLSX from "xlsx";
import { fetchUserMonthAttendance, fetchAttendanceRange, getHolidays } from "../firebase/attendanceFunctions";

export default function ExportAttendanceModal({ userId, onClose }) {
  const [mode, setMode] = useState("month"); // "month" or "all"
  const [loading, setLoading] = useState(false);
  const [records, setRecords] = useState([]);
  const [holidays, setHolidays] = useState([]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        if (mode === "month") {
          const rec = await fetchUserMonthAttendance(userId);
          setRecords(rec || []);
        } else {
          // entire history
          const rows = await fetchAttendanceRange("1900-01-01", "9999-12-31");
          // filter to userId if provided
          setRecords(userId ? rows.filter(r => r.userId === userId) : rows);
        }
        setHolidays(await getHolidays());
      } catch (e) {
        console.error("Export load err", e);
      } finally {
        setLoading(false);
      }
    })();
  }, [mode, userId]);

  const minutesToHrsStr = (mins) => {
    if (mins === undefined || mins === null) return "-";
    const h = Math.floor(mins/60);
    const m = mins % 60;
    return `${h}:${String(m).padStart(2, "0")}`;
  };

  const exportExcel = () => {
    if (!records || !records.length) {
      alert("No records to export");
      return;
    }

    // Build worksheet rows (human readable)
    const rows = records.map(r => {
      const date = r.date;
      const totalMinutes = Number(r.totalMinutes || 0);
      // half-day rule: below 7 hours => half-day
      const status = totalMinutes > 0 && totalMinutes < (7 * 60) ? "half-day" : (r.status || "absent");
      return {
        Date: date,
        User: r.userName || r.userId || "",
        Status: status,
        Minutes: totalMinutes,
        Hours: minutesToHrsStr(totalMinutes),
      };
    });

    const ws = XLSX.utils.json_to_sheet(rows, { skipHeader: false });

    // Apply style by walking cells. We'll paint rows based on Status:
    // present (green), half-day (yellow), absent (red), holiday (purple).
    // The cell style property is `.s` — different environments may or may not support it.
    const range = XLSX.utils.decode_range(ws['!ref']);
    for (let R = range.s.r; R <= range.e.r; ++R) {
      // Status column index: find column with header "Status"
      // We'll build mapping once
    }

    // Create header->col mapping
    const headerMap = {};
    const headerRow = XLSX.utils.sheet_to_json(ws, { header: 1, range: 0, raw: true })[0] || [];
    headerRow.forEach((h, idx) => { headerMap[h] = idx; });

    // function to set style for a row
    function setRowStyle(rowIdx, fillHex) {
      for (let c = range.s.c; c <= range.e.c; ++c) {
        const cellAddress = XLSX.utils.encode_cell({ r: rowIdx, c });
        if (!ws[cellAddress]) continue;
        ws[cellAddress].s = ws[cellAddress].s || {};
        // Background fill
        ws[cellAddress].s.fill = {
          patternType: "solid",
          fgColor: { rgb: fillHex.replace("#","").toUpperCase() }
        };
        // keep font contrast
        ws[cellAddress].s.font = ws[cellAddress].s.font || { bold: false };
      }
    }

    // Walk rows (data start at row 1)
    const statusCol = headerMap["Status"];
    for (let r = 1; r <= range.e.r; ++r) {
      const addr = XLSX.utils.encode_cell({ r, c: statusCol });
      const cell = ws[addr];
      const statusVal = cell ? String(cell.v || "").toLowerCase() : "";

      // Holiday check by date cell
      const dateAddr = XLSX.utils.encode_cell({ r, c: headerMap["Date"] });
      const dateCell = ws[dateAddr];
      const dateVal = dateCell ? String(dateCell.v || "") : "";
      const isHoliday = (holidays || []).some(h => (typeof h === "string" ? h : h.id || h.date) === dateVal);

      if (isHoliday) {
        setRowStyle(r, "#8A7BDC"); // purple
      } else if (statusVal === "present") {
        setRowStyle(r, "#D4F8D4"); // green
      } else if (statusVal === "half-day" || statusVal === "half") {
        setRowStyle(r, "#FFF4C2"); // yellow
      } else {
        setRowStyle(r, "#FFD2D2"); // red
      }
    }

    // Create workbook
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, mode === "month" ? "Month" : "AllHistory");

    // Try write with cellStyles option (some builds require explicit option)
    try {
      XLSX.writeFile(wb, mode === "month" ? `Attendance_${new Date().toISOString().slice(0,7)}.xlsx` : "Attendance_All_History.xlsx", { bookType: "xlsx", cellStyles: true });
    } catch (e) {
      // fallback – try without cellStyles
      console.warn("writeFile with styles failed:", e);
      XLSX.writeFile(wb, mode === "month" ? `Attendance_${new Date().toISOString().slice(0,7)}.xlsx` : "Attendance_All_History.xlsx");
    }

    onClose && onClose();
  };

  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.4)", display:"flex", justifyContent:"center", alignItems:"center" }}>
      <div style={{ background:"#fff", padding:20, borderRadius:8, width:420 }}>
        <h3>Export Attendance</h3>

        <div style={{ marginBottom: 12 }}>
          <label><input type="radio" checked={mode === "month"} onChange={() => setMode("month")} /> Current month</label>
          <label style={{ marginLeft: 12 }}><input type="radio" checked={mode === "all"} onChange={() => setMode("all")} /> All history</label>
        </div>

        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={exportExcel} style={{ flex: 1, background: "#800000", color:"#fff", padding: 10, borderRadius: 6 }}>Export</button>
          <button onClick={onClose} style={{ padding: 10 }}>Cancel</button>
        </div>

        <div style={{ marginTop: 10, color: "#666", fontSize: 13 }}>
          Notes:
          <ul>
            <li>Half-day = &lt; 7 hours.</li>
            <li>Export keeps colour formatting (Excel readers may vary).</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
