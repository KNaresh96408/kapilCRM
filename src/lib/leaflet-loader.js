// src/lib/leaflet-loader.js
export async function loadLeaflet() {
  try {
    const L = await import("leaflet");
    await import("leaflet/dist/leaflet.css");
    return L.default || L;
  } catch (err) {
    console.error("Leaflet load failed:", err);
    return null;
  }
}
