const normalizeKey = (value) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "")
    .replace(/[^a-z0-9]/g, "");

const normalizeStateKey = (value) => {
  const v = normalizeKey(value);
  if (!v) return "";
  if (v.includes("telanagna") || v.includes("telangana")) return "telangana";
  if (v.includes("andhrapradesh") || v.includes("andhraprades")) return "andhrapradesh";
  return v;
};

const SALES_REGIONS = {
  telangana: {
    label: "Telangana",
    zones: {
      hyd: { label: "Hyd", areas: ["Hyderabad", "Bhuvangiri"] },
      warangal: { label: "Warangal", areas: ["Karimnagar", "Kamareddy", "Warangal"] },
      mbnr: { label: "MBNR", areas: ["Sangareddy", "MBNR", "Gadwal"] },
      nizamabad: { label: "Nizamabad", areas: ["Adilabad", "Nizamabad", "Jagtial"] },
      khammam: { label: "Khammam", areas: ["Nalgonda", "Jangoan", "Khammam"] },
    },
  },
  andhrapradesh: {
    label: "AndhraPradesh",
    zones: {
      vizag: { label: "Vizag", areas: ["Vizianagaram", "Vishakapatnam"] },
      vijayawada: { label: "Vijayawada", areas: ["Kakinada", "Eluru"] },
      amaravathi: { label: "Amaravathi", areas: ["Guntur", "Prakasam"] },
      kadapa: { label: "Kadapa", areas: ["Anantapuram", "Kadapa"] },
      tirupathi: { label: "Tirupathi", areas: ["Annamayya", "Tirupathi"] },
    },
  },
};

const AREA_ALIASES = {
  bhuvanagiri: "Bhuvangiri",
  ananthapuram: "Anantapuram",
  visakhapatnam: "Vishakapatnam",
  jangaoan: "Jangoan",
};

const normalizeAreaKey = (value) => {
  const v = normalizeKey(value);
  if (!v) return "";
  return normalizeKey(AREA_ALIASES[v] || v);
};

const getZoneKey = (stateKey, zoneValue) => {
  const entry = SALES_REGIONS[stateKey];
  if (!entry) return "";
  const zVal = normalizeKey(zoneValue);
  if (!zVal) return "";

  const direct = Object.entries(entry.zones).find(
    ([key, zone]) => normalizeKey(key) === zVal || normalizeKey(zone.label) === zVal
  );
  if (direct) return direct[0];

  const aliasMap = {
    hyd: ["hyderabad"],
    warangal: ["waranagl"],
    mbnr: ["mahbubnagar", "mahbubnagar", "mbnr"],
    nizamabad: ["nizamabad"],
    khammam: ["khammam"],
    vizag: ["visakhapatnam"],
    vijayawada: ["vijayawada"],
    amaravathi: ["amaravati", "amaravathi"],
    kadapa: ["kadapa", "cuddapah"],
    tirupathi: ["tirupati", "tirupathi"],
  };

  const aliased = Object.entries(aliasMap).find(([, aliases]) =>
    aliases.some((a) => normalizeKey(a) === zVal)
  );
  if (aliased) return aliased[0];

  return "";
};

export const getStateOptions = () =>
  Object.values(SALES_REGIONS).map((s) => s.label);

export const getZoneOptions = (stateValue) => {
  const stateKey = normalizeStateKey(stateValue);
  const entry = SALES_REGIONS[stateKey];
  if (!entry) return [];
  return Object.values(entry.zones).map((z) => z.label);
};

export const getAreaOptions = (stateValue, zoneValue) => {
  const stateKey = normalizeStateKey(stateValue);
  const zoneKey = getZoneKey(stateKey, zoneValue);
  if (!stateKey || !zoneKey) return [];
  const entry = SALES_REGIONS[stateKey];
  if (!entry) return [];
  return entry.zones[zoneKey]?.areas || [];
};

export const isKnownState = (stateValue) => {
  const key = normalizeStateKey(stateValue);
  return !!SALES_REGIONS[key];
};

export const isZoneInState = (stateValue, zoneValue) => {
  const stateKey = normalizeStateKey(stateValue);
  const zoneKey = getZoneKey(stateKey, zoneValue);
  return !!stateKey && !!zoneKey;
};

export const isAreaInZone = (stateValue, zoneValue, areaValue) => {
  const areas = getAreaOptions(stateValue, zoneValue);
  const target = normalizeAreaKey(areaValue);
  if (!target) return false;
  return areas.some((a) => normalizeAreaKey(a) === target);
};
