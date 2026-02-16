// lib/auth.ts
import {
  getAuth,
  signInAnonymously,
  onAuthStateChanged,
  signOut,
  User,
} from "firebase/auth";
import { app } from "./firebase";

/**
 * Customers ONLY.
 * Ensures there is *some* signed-in Firebase Auth user (anon).
 */
export async function ensureCustomerAnonAuth(): Promise<User> {
  const auth = getAuth(app);
  if (auth.currentUser) return auth.currentUser;
  const cred = await signInAnonymously(auth);
  return cred.user;
}

/**
 * Helper: return current user once auth is ready.
 */
export function waitForAuthReady(): Promise<User | null> {
  const auth = getAuth(app);
  return new Promise((resolve) => {
    const unsub = onAuthStateChanged(auth, (u) => {
      unsub();
      resolve(u);
    });
  });
}

/**
 * Sign out completely.
 */
export async function fullSignOut() {
  const auth = getAuth(app);
  await signOut(auth);
}

/* =========================================================
   COMPATIBILITY HELPERS (to stop build errors)
   These exist only because older pages import them.
   ========================================================= */

/**
 * Old name used in some components.
 * Just calls ensureCustomerAnonAuth().
 */
export async function allowAnonAuth(): Promise<User> {
  return ensureCustomerAnonAuth();
}

// Old name used on merchant pages.
// Merchants should NOT operate while anon.
// If current user is anon, sign them out and return null.
export async function blockAnonAuth(): Promise<User | null> {
  const auth = getAuth(app);
  const u = await waitForAuthReady();

  if (!u) return null;

  if (u.isAnonymous) {
    // ✅ Don’t crash the page — just sign out the anon customer session
    await signOut(auth);
    return null;
  }

  return u;
}

