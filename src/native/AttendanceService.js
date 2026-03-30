import { registerPlugin } from "@capacitor/core";
import BackgroundGeolocation from "@transistorsoft/capacitor-background-geolocation";

export const AttendanceService = registerPlugin("AttendanceService");
const BackgroundGeolocationAlt = registerPlugin("BackgroundGeolocationPlugin");

let bgReady = false;
let locationSub = null;
let heartbeatSub = null;

const bgCall = async (method, ...args) => {
	try {
		return await BackgroundGeolocation[method](...args);
	} catch (e) {
		if (e?.code === "UNIMPLEMENTED") {
			console.warn("BackgroundGeolocation primary plugin unavailable, retrying with alternate plugin id", method);
			return await BackgroundGeolocationAlt[method](...args);
		}
		throw e;
	}
};

// Call this once on app start (or before starting tracking)
export const initBackgroundGeolocation = async () => {
	if (bgReady) return;
	await bgCall("ready", {
		// Paste your license key below
		license: "1ae209b5c82aa79f43f2ca3057e367b1b8c4d0d68a324a2f84202efc634d55e5",
		locationAuthorizationRequest: "Always",
		desiredAccuracy: BackgroundGeolocation.DESIRED_ACCURACY_HIGH,
		distanceFilter: 100,
		heartbeatInterval: 300,
		stopOnTerminate: false,
		startOnBoot: true,
		autoStart: false,
		preventSuspend: true,
		pausesLocationUpdatesAutomatically: false,
		showsBackgroundLocationIndicator: true,
		debug: false,
		logLevel: BackgroundGeolocation.LOG_LEVEL_INFO,
	});
	bgReady = true;
};

export const setBackgroundLocationHandler = (handler) => {
	if (locationSub) {
		locationSub.remove();
		locationSub = null;
	}
	if (heartbeatSub) {
		heartbeatSub.remove();
		heartbeatSub = null;
	}
	locationSub = BackgroundGeolocation.onLocation(
		(location) => handler(location),
		(error) => console.warn("BG location error", error)
	);

	heartbeatSub = BackgroundGeolocation.onHeartbeat(async () => {
		try {
			const location = await bgCall("getCurrentPosition", {
				persist: false,
				samples: 1,
				timeout: 30,
				desiredAccuracy: BackgroundGeolocation.DESIRED_ACCURACY_MEDIUM,
				maximumAge: 120000,
			});
			if (location) handler(location);
		} catch (e) {
			console.warn("BG heartbeat location error", e);
		}
	});
};

export const clearBackgroundLocationHandler = () => {
	if (locationSub) {
		locationSub.remove();
		locationSub = null;
	}
	if (heartbeatSub) {
		heartbeatSub.remove();
		heartbeatSub = null;
	}
};

export const startBackgroundTracking = async () => {
	await initBackgroundGeolocation();
	await bgCall("start");
};

export const stopBackgroundTracking = async () => {
	await bgCall("stop");
};
