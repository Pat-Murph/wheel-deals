import { initializeApp, getApps, FirebaseApp } from "firebase/app";
import { getFirestore, Firestore } from "firebase/firestore";
import { getStorage, FirebaseStorage } from "firebase/storage";

function getFirebaseConfig() {
  return {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY ?? "placeholder",
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN ?? "placeholder.firebaseapp.com",
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? "placeholder",
    storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ?? "placeholder.appspot.com",
    messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ?? "000000000000",
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID ?? "1:000000000000:web:placeholder",
  };
}

let _app: FirebaseApp;
let _db: Firestore;
let _storage: FirebaseStorage;

function getApp(): FirebaseApp {
  if (!_app) {
    _app = getApps().length ? getApps()[0] : initializeApp(getFirebaseConfig());
  }
  return _app;
}

export const app = new Proxy({} as FirebaseApp, {
  get(_t, prop) { return (getApp() as any)[prop]; },
});

export const db = new Proxy({} as Firestore, {
  get(_t, prop) {
    if (!_db) _db = getFirestore(getApp());
    return (_db as any)[prop];
  },
});

export const storage = new Proxy({} as FirebaseStorage, {
  get(_t, prop) {
    if (!_storage) _storage = getStorage(getApp());
    return (_storage as any)[prop];
  },
});
