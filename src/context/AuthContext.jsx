import { createContext, useContext, useEffect, useState } from "react";
import { Capacitor } from "@capacitor/core";

// 🔐 use SINGLE auth instance (do NOT call getAuth again)
import { auth, getDB } from "../firebaseConfig";

// Firebase SDK helpers
import { onAuthStateChanged } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";

const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [roleData, setRoleData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // 🛑 iOS WKWebView SAFETY:
    // delay auth listener slightly ONLY on iOS
    const delay = Capacitor.getPlatform() === "ios" ? 600 : 0;

    const timer = setTimeout(() => {
      const unsubscribe = onAuthStateChanged(auth, async (u) => {
        if (!u) {
          setUser(null);
          setRoleData(null);
          setLoading(false);
          return;
        }

        try {
          setUser(u);

          const db = getDB();
          const snap = await getDoc(doc(db, "Users", u.uid));

          if (snap.exists()) {
            setRoleData(snap.data());
          }
        } catch (err) {
          console.error("AuthContext Firestore error:", err);
        }

        setLoading(false);
      });

      // cleanup auth listener
      return () => unsubscribe();
    }, delay);

    return () => clearTimeout(timer);
  }, []);

  return (
    <AuthContext.Provider value={{ user, roleData, loading }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
