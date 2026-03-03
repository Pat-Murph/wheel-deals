import { initializeApp, getApps, type FirebaseApp } from "firebase/app";
import { getFirestore, type Firestore } from "firebase/firestore";
import { getStorage, type FirebaseStorage } from "firebase/storage";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY ?? "placeholder-key",
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN ?? "placeholder.firebaseapp.com",
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? "placeholder-project",
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ?? "placeholder.appspot.com",
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ?? "000000000000",
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID ?? "1:000000000000:web:placeholder",
};

let _app: FirebaseApp | null = null;
let _db: Firestore | null = null;
let _storage: FirebaseStorage | null = null;

function getFirebaseApp(): FirebaseApp {
  if (!_app) {
    _app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
  }
  return _app;
}

/** Returns the real Firestore instance. Call this instead of using `db` directly. */
export function getDb(): Firestore {
  if (!_db) _db = getFirestore(getFirebaseApp());
  return _db;
}

/** Returns the real Storage instance. Call this instead of using `storage` directly. */
export function getStorageInstance(): FirebaseStorage {
  if (!_storage) _storage = getStorage(getFirebaseApp());
  return _storage;
}

/** @deprecated Use getDb() instead */
export const db: Firestore = new Proxy({} as Firestore, {
  get(_t, prop) {
    const real = getDb();
    const val = (real as any)[prop];
    return typeof val === "function" ? val.bind(real) : val;
  },
  getPrototypeOf() {
    return Object.getPrototypeOf(getDb());
  },
  has(_t, prop) {
    return prop in getDb();
  },
});

/** @deprecated Use getStorageInstance() instead */
export const storage: FirebaseStorage = new Proxy({} as FirebaseStorage, {
  get(_t, prop) {
    const real = getStorageInstance();
    const val = (real as any)[prop];
    return typeof val === "function" ? val.bind(real) : val;
  },
  getPrototypeOf() {
    return Object.getPrototypeOf(getStorageInstance());
  },
});

export const app: FirebaseApp = new Proxy({} as FirebaseApp, {
  get(_t, prop) {
    const real = getFirebaseApp();
    const val = (real as any)[prop];
    return typeof val === "function" ? val.bind(real) : val;
  },
});
