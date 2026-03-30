import { Capacitor } from '@capacitor/core';
import { PushNotifications } from '@capacitor/push-notifications';
import { LocalNotifications } from '@capacitor/local-notifications';
import { arrayUnion, doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { auth, db } from '../firebaseConfig';

let listenersAttached = false;
let registrationInProgress = false;

const resolveSessionUser = () => {
  try {
    const raw = localStorage.getItem('kp-user');
    const parsed = raw ? JSON.parse(raw) : null;
    return {
      uid: parsed?.uid || parsed?.profile?.uid || auth.currentUser?.uid || '',
      email: parsed?.email || parsed?.profile?.email || auth.currentUser?.email || '',
    };
  } catch {
    return {
      uid: auth.currentUser?.uid || '',
      email: auth.currentUser?.email || '',
    };
  }
};

const upsertTokenForUser = async (tokenValue, uidParam = '', emailParam = '') => {
  const token = String(tokenValue || '').trim();
  if (!token) return;

  const uid = String(uidParam || '').trim();
  if (!uid) {
    console.warn('⚠️ Push token skipped: missing uid');
    return;
  }

  try {
    await setDoc(
      doc(db, 'Users', uid),
      {
        uid,
        ...(emailParam ? { email: emailParam } : {}),
        mobileFcmTokens: arrayUnion(token),
        fcmTokens: arrayUnion(token),
        fcmToken: token,
        pushPlatform: Capacitor.getPlatform(),
        pushEnabled: true,
        pushTokenUpdatedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );

    console.log('🟢 Push token saved for user', uid);
  } catch (e) {
    console.warn('⚠️ Push token save failed', e?.message || e);
  }
};

const attachPushListeners = () => {
  if (listenersAttached) return;

  PushNotifications.addListener('pushNotificationReceived', async (event) => {
    try {
      const title = String(event?.title || event?.notification?.title || '').trim();
      const body = String(event?.body || event?.notification?.body || '').trim();
      if (!title && !body) return;

      const permission = await LocalNotifications.checkPermissions();
      if (permission.display !== 'granted') {
        const asked = await LocalNotifications.requestPermissions();
        if (asked.display !== 'granted') return;
      }

      await LocalNotifications.schedule({
        notifications: [
          {
            id: Date.now() % 2147483647,
            title: title || 'Kapil Power CRM',
            body: body || 'You have a new notification',
            schedule: { at: new Date(Date.now() + 250) },
          },
        ],
      });
    } catch (e) {
      console.warn('⚠️ Foreground push display failed', e?.message || e);
    }
  });

  PushNotifications.addListener('registration', async (token) => {
    try {
      const user = resolveSessionUser();
      await upsertTokenForUser(token?.value, user.uid, user.email);
    } catch (e) {
      console.warn('⚠️ Push registration listener error', e?.message || e);
    }
  });

  PushNotifications.addListener('registrationError', (error) => {
    console.warn('⚠️ Push registrationError', error);
  });

  PushNotifications.addListener('pushNotificationActionPerformed', (event) => {
    try {
      const data = event?.notification?.data || {};
      const type = String(data.type || '');
      const refType = String(data.referenceType || '');
      const refId = String(data.referenceId || '');
      const route = String(data.route || '').trim();

      if (route) {
        const safeRoute = route.startsWith('/') ? route : `/${route}`;
        window.location.hash = `#${safeRoute}`;
        return;
      }

      if (['po_approval', 'po_status_update', 'po_payment_update'].includes(type)) {
        const target = refType === 'servicePurchaseOrder' ? 'service-po' : 'material-po';
        const query = new URLSearchParams({
          notification: '1',
          purchaseItem: target,
          tab: 'approval',
          refId,
        }).toString();
        window.location.hash = `#/books/purchase?${query}`;
        return;
      }

      if (type.startsWith('leave_') || String(data.module || '').toLowerCase() === 'attendance') {
        window.location.hash = '#/attendance';
        return;
      }

      window.location.hash = '#/notifications';
    } catch (e) {
      console.warn('⚠️ Push action handler error', e?.message || e);
    }
  });

  listenersAttached = true;
};

export const initMobilePushNotifications = async () => {
  if (!Capacitor.isNativePlatform()) return;
  if (registrationInProgress) return;

  registrationInProgress = true;
  try {
    attachPushListeners();

    const permission = await PushNotifications.requestPermissions();
    if (permission.receive !== 'granted') {
      console.warn('⚠️ Push permission not granted');
      return;
    }

    await PushNotifications.register();
  } catch (e) {
    console.warn('⚠️ Push init failed', e?.message || e);
  } finally {
    registrationInProgress = false;
  }
};

export const syncPushTokenForCurrentUser = async (uid, email = '') => {
  if (!Capacitor.isNativePlatform()) return;
  if (!uid) return;

  try {
    const permission = await PushNotifications.checkPermissions();
    if (permission.receive !== 'granted') return;

    attachPushListeners();
    await PushNotifications.register();

    // Fallback in case registration listener fires before uid is available.
    // No direct token getter is available; rely on listener + stored session values.
    const session = resolveSessionUser();
    if (session.uid && session.uid === uid) {
      // no-op; registration callback handles write.
    }
  } catch (e) {
    console.warn('⚠️ Push sync failed', e?.message || e);
  }
};
