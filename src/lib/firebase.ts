import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyDVZkCa_zohEQXWgd_dbKBHQwpMxSlFQms",
  authDomain: "lucky-rookery-d3bk6.firebaseapp.com",
  projectId: "lucky-rookery-d3bk6",
  storageBucket: "lucky-rookery-d3bk6.firebasestorage.app",
  messagingSenderId: "1079687769739",
  appId: "1:1079687769739:web:28d1a148a418f6172a2e8e"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
