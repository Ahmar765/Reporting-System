import { initializeApp } from 'firebase/app';
import { getAuth, connectAuthEmulator } from 'firebase/auth';
import { getFirestore, connectFirestoreEmulator } from 'firebase/firestore';

// Public Firebase web configuration. Private Admin SDK credentials never enter this build.
export const firebaseConfig = {
  apiKey: 'AIzaSyAXKAm7mF6v8y4JJMyPkGYuK9_UK5oxLFg',
  authDomain: 'cadence-53781.firebaseapp.com',
  projectId: import.meta.env.DEV && import.meta.env.VITE_FIREBASE_EMULATORS === '1' ? 'demo-cadence' : 'cadence-53781',
  storageBucket: 'cadence-53781.firebasestorage.app',
  messagingSenderId: '484887934906',
  appId: '1:484887934906:web:d8ca96ad5e48ece54f0f83'
};
export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const firestore = getFirestore(app);
if (import.meta.env.DEV && import.meta.env.VITE_FIREBASE_EMULATORS === '1') {
  connectAuthEmulator(auth, 'http://127.0.0.1:9098', { disableWarnings: true });
  connectFirestoreEmulator(firestore, '127.0.0.1', 8085);
}
