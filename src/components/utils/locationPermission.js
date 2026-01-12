import { Geolocation } from '@capacitor/geolocation';
import { App } from '@capacitor/app';

export async function ensureLocationPermission() {
  // 1️⃣ Check current permission state
  const perm = await Geolocation.checkPermissions();
  console.log("📍 Location permission status:", perm);

  if (perm.location === 'granted') {
    return true;
  }

  // 2️⃣ Request permission (this triggers popup)
  const req = await Geolocation.requestPermissions({
    permissions: ['location'],
  });

  console.log("📍 Location permission after request:", req);

  if (req.location === 'granted') {
    return true;
  }

  // 3️⃣ Still denied → open settings
  alert("Location permission is required for check-in. Please allow it in app settings.");
  await App.openSettings();

  return false;
}
