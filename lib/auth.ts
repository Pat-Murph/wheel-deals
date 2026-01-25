import { getAuth, signInAnonymously } from "firebase/auth";
import { app } from "./firebase";

export async function ensureAnonAuth() {
  const auth = getAuth(app);
  if (auth.currentUser) return auth.currentUser;
  const cred = await signInAnonymously(auth);
  return cred.user;
}
