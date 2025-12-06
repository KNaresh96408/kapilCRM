import React, { useState, useEffect } from "react";

// FieldPropertyEditor_Full.jsx
// Full advanced field property editor (Step 6)
// Supports: default value, min/max, regex, number formatting, currency, lookup settings, auto-number, formula fields, user fields.
// Place at: src/components/Settings/FieldPropertyEditor_Full.jsx

export default function FieldPropertyEditorFull({ field, onClose, onSave }) {
  const [label, setLabel] = useState("");
  const [required, setRequired] = useState(false);
  const [defaultValue, setDefaultValue] = useState("");
  const [minLength, setMinLength] = useState("");
  const [maxLength, setMaxLength] = useState("");
  const [regex, setRegex] = useState("");
  const [options, setOptions] = useState([]);

  // Number / Currency
  const [decimalPlaces, setDecimalPlaces] = useState(2);
  const [currencySymbol, setCurrencySymbol] = useState("₹");

  // Lookup
  const [lookupModule, setLookupModule] = useState("");
  const [lookupField, setLookupField] = useState("");

  // Auto-number
  const [prefix, setPrefix] = useState("");
  const [startNumber, setStartNumber] = useState(1);
  const [suffix, setSuffix] = useState("");

  // Formula
  const [formulaExpression, setFormulaExpression] = useState("");

  useEffect(() => {
    if (!field) return;

    setLabel(field.label || "");
    setRequired(field.required || false);
    setDefaultValue(field.defaultValue || "");
    setMinLength(field.minLength || "");
    setMaxLength(field.maxLength || "");
    setRegex(field.regex || "");
    setOptions(field.options || []);
    setDecimalPlaces(field.decimalPlaces || 2);
    setCurrencySymbol(field.currencySymbol || "₹");
    setLookupModule(field.lookupModule || "");
    setLookupField(field.lookupField || "");
    setPrefix(field.prefix || "");
    setStartNumber(field.startNumber || 1);
    setSuffix(field.suffix || "");
    setFormulaExpression(field.formulaExpression || "");
  }, [field]);

  const handleAddOption = () => {
    const v = prompt("Option value");
    if (v) setOptions([...options, v]);
  };

  const handleSave = () => {
    onSave({
      ...field,
      label,
      required,
      defaultValue,
      minLength,
      maxLength,
      regex,
      options,
      decimalPlaces,
      currencySymbol,
      lookupModule,
      lookupField,
      prefix,
      startNumber,
      suffix,
      formulaExpression,
    });
  };

  if (!field) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-40 flex justify-center items-center z-50 p-4 overflow-y-auto">
      <div className="bg-white rounded-lg p-6 w-full max-w-2xl shadow-lg">
        <h2 className="text-xl font-semibold mb-4">Advanced Field Settings</h2>

        {/* LABEL */}
        <label className="block font-medium text-sm mb-1">Label</label>
        <input className="w-full border rounded px-2 py-1 mb-4" value={label} onChange={(e) => setLabel(e.target.value)} />

        {/* REQUIRED */}
        <div className="flex items-center gap-2 mb-4">
          <input type="checkbox" checked={required} onChange={(e) => setRequired(e.target.checked)} />
          <span className="text-sm">Required</span>
        </div>

        {/* DEFAULT VALUE */}
        <label className="block font-medium text-sm mb-1">Default Value</label>
        <input className="w-full border rounded px-2 py-1 mb-4" value={defaultValue} onChange={(e) => setDefaultValue(e.target.value)} />

        {/* STRING RULES */}
        {(field.type === "Single Line" || field.type === "Multi-Line") && (
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-sm font-medium mb-1">Min Length</label>
              <input className="w-full border rounded px-2 py-1" value={minLength} onChange={(e) => setMinLength(e.target.value)} />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Max Length</label>
              <input className="w-full border rounded px-2 py-1" value={maxLength} onChange={(e) => setMaxLength(e.target.value)} />
            </div>
          </div>
        )}

        {/* REGEX */}
        <label className="block text-sm font-medium mb-1">Validation Regex (optional)</label>
        <input className="w-full border rounded px-2 py-1 mb-4" value={regex} onChange={(e) => setRegex(e.target.value)} />

        {/* PICKLISTS */}
        {(field.type === "Pick List" || field.type === "Multi-Select") && (
          <div className="mb-4">
            <label className="block mb-1 font-medium text-sm">Options</label>
            <div className="space-y-1 mb-2">
              {options.map((op, i) => (
                <div key={i} className="p-1 bg-gray-100 rounded text-sm">{op}</div>
              ))}
            </div>
            <button className="px-3 py-1 bg-indigo-600 text-white rounded text-sm" onClick={handleAddOption}>Add Option</button>
          </div>
        )}

        {/* NUMBER / DECIMAL / CURRENCY */}
        {(field.type === "Number" || field.type === "Decimal" || field.type === "Currency") && (
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-sm font-medium mb-1">Decimal Places</label>
              <input type="number" className="w-full border rounded px-2 py-1" value={decimalPlaces} onChange={(e) => setDecimalPlaces(Number(e.target.value))} />
            </div>
            {field.type === "Currency" && (
              <div>
                <label className="block text-sm font-medium mb-1">Currency Symbol</label>
                <input className="w-full border rounded px-2 py-1" value={currencySymbol} onChange={(e) => setCurrencySymbol(e.target.value)} />
              </div>
            )}
          </div>
        )}

        {/* LOOKUP FIELDS */}
        {field.type === "Lookup" && (
          <div className="mb-4">
            <label className="block text-sm font-medium mb-1">Lookup Module</label>
            <input className="w-full border rounded px-2 py-1 mb-2" value={lookupModule} onChange={(e) => setLookupModule(e.target.value)} placeholder="Module name e.g. Contacts" />

            <label className="block text-sm font-medium mb-1">Related Field</label>
            <input className="w-full border rounded px-2 py-1" value={lookupField} onChange={(e) => setLookupField(e.target.value)} placeholder="e.g. contactName" />
          </div>
        )}

        {/* AUTO-NUMBER */}
        {field.type === "Auto-Number" && (
          <div className="grid grid-cols-3 gap-4 mb-4">
            <div>
              <label className="block text-sm font-medium mb-1">Prefix</label>
              <input className="w-full border rounded px-2 py-1" value={prefix} onChange={(e) => setPrefix(e.target.value)} />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Start Number</label>
              <input type="number" className="w-full border rounded px-2 py-1" value={startNumber} onChange={(e) => setStartNumber(Number(e.target.value))} />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Suffix</label>
              <input className="w-full border rounded px-2 py-1" value={suffix} onChange={(e) => setSuffix(e.target.value)} />
            </div>
          </div>
        )}

        {/* FORMULA */}
        {field.type === "Formula" && (
          <div className="mb-4">
            <label className="block text-sm font-medium mb-1">Formula Expression</label>
            <textarea className="w-full border rounded px-2 py-1 h-24" value={formulaExpression} onChange={(e) => setFormulaExpression(e.target.value)} />
            <p className="text-xs text-gray-500 mt-1">Example: (Amount * 0.18)</p>
          </div>
        )}

        <div className="flex justify-end gap-3 mt-6">
          <button className="px-4 py-2 border rounded-md" onClick={onClose}>Cancel</button>
          <button className="px-4 py-2 bg-indigo-600 text-white rounded-md" onClick={handleSave}>Save Changes</button>
        </div>
      </div>
    </div>
  );
}