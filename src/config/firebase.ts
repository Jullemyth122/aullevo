import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth, GoogleAuthProvider } from "firebase/auth";

const firebaseConfig = {
  apiKey: "AIzaSyCgmniUJIATTPwlcK9mn7ur3ZS1saDQ6Cs",
  authDomain: "aullevo-data.firebaseapp.com",
  projectId: "aullevo-data",
  storageBucket: "aullevo-data.firebasestorage.app",
  messagingSenderId: "248226640621",
  appId: "1:248226640621:web:859d11c34b6b00ddb892e4",
  measurementId: "G-T715FHZTDJ",
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({
  prompt: 'select_account'
});
