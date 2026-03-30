import { useEffect, useState } from "react";
import { db } from "../firebaseConfig";
import { doc, getDoc } from "firebase/firestore";
import { useAuth } from "../context/AuthContext";

const normalizeRole = (raw) => {
  const base = (raw || "").toString().trim().toLowerCase();
  if (!base) return "";
  const underscored = base.replace(/[\s-]+/g, "_").replace(/_+/g, "_");
  const compact = underscored.replace(/_/g, "");
  const aliasByCompact = {
    saleshead: "sales_head",
    hroperationsmanager: "agm",
    hr_operations_manager: "agm",
    agm: "agm",
    financemanager: "dgm",
    finance_manager: "dgm",
    dgm: "dgm",
    salesheadmanager: "sales_head",
  };
  return aliasByCompact[compact] || underscored;
};
export function usePermission(moduleName) {
  const [perm, setPerm] = useState({
    loading: true,
    create: false,
    read: false,
    update: false,
    delete: false,
  });

  const { modulePerms, user } = useAuth();

  useEffect(() => {
    const load = async () => {
      try {
        if (!user) {
          setPerm({ loading: false, create: false, read: false, update: false, delete: false });
          return;
        }

        const keyVariants = [
          moduleName,
          moduleName?.toLowerCase(),
          moduleName?.replace(/_/g, "-"),
          moduleName?.replace(/-/g, "_"),
          moduleName?.replace(/[-_]/g, ""),
        ].filter(Boolean);

        // Fast-path: consult cached modulePerms from AuthContext synchronously
        try {
          if (modulePerms && Object.keys(modulePerms).length) {
            for (const key of keyVariants) {
              const cached = modulePerms[key];
              if (cached) {
                setPerm({ ...cached, loading: false });
                return;
              }
            }
            // modulePerms loaded but no entry for this module
            setPerm({ loading: false, create: false, read: false, update: false, delete: false });
            return;
          }
        } catch (e) {
          console.warn('usePermission: cache read failed', e);
        }

        const role = normalizeRole(user?.role || user?.Role || "");
        // SUPER ROLES FULL ACCESS
        const SUPER_ROLES = [
          "admin",
          "sales_head",
          "director",
          "dgm",
          "agm",
        ];

        if (
          SUPER_ROLES.includes(role) ||
          user?.email === "loan@kapilpower.com" ||
          user?.uid === "26VHcREEDMMg8C24kXYVGzRXHe43"
        ) {
          setPerm({
            loading: false,
            create: true,
            read: true,
            update: true,
            delete: true,
          });
          return;
        }

        const ref = doc(db, "modulePermissions", moduleName, "users", user.uid);

        const TIMEOUT_MS = 2500;
        try {
          const getPromise = getDoc(ref);
          const snap = await Promise.race([
            getPromise,
            new Promise((_, reject) => setTimeout(() => reject(new Error('perm fetch timeout')), TIMEOUT_MS)),
          ]);

          if (!snap || !snap.exists || !snap.exists()) {
            setPerm({ loading: false, create: false, read: false, update: false, delete: false });
            return;
          }

          setPerm({ ...snap.data(), loading: false });
        } catch (err) {
          console.warn('🟡 usePermission DB fetch failed, trying REST', err && (err.message || err));
          try {
            const stored = typeof window !== 'undefined' ? localStorage.getItem('kp-user') : null;
            const parsed = stored ? JSON.parse(stored) : null;
            const token = (parsed && parsed.idToken) || null;
            if (token) {
              const { fetchDocumentREST } = await import('../helpers/firestoreRest');
              const rest = await fetchDocumentREST(`modulePermissions/${moduleName}/users/${user.uid}`, token);
              if (rest) {
                setPerm({ ...rest, loading: false });
                return;
              }
            }
          } catch (restErr) {
            console.warn('⚠️ usePermission REST failed', restErr && (restErr.message || restErr));
          }

          setPerm({ loading: false, create: false, read: false, update: false, delete: false });
        }
      } catch (e) {
        console.error(e);
        setPerm({ loading: false, create: false, read: false, update: false, delete: false });
      }
    };

    load();
  }, [moduleName, modulePerms, user]);

  return perm;
}
