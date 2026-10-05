/**
 * Firebase Configuration
 * Update these values with your Firebase project credentials
 */

import { initializeApp } from 'firebase/app';
import { getDatabase, ref, onValue, set, remove } from 'firebase/database';
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: process.env.REACT_APP_FIREBASE_API_KEY || 'YOUR_API_KEY',
  authDomain: process.env.REACT_APP_FIREBASE_AUTH_DOMAIN || 'scream-XXXXX.firebaseapp.com',
  databaseURL: process.env.REACT_APP_FIREBASE_DATABASE_URL || 'https://scream-XXXXX-default-rtdb.firebaseio.com',
  projectId: process.env.REACT_APP_FIREBASE_PROJECT_ID || 'scream-XXXXX',
  storageBucket: process.env.REACT_APP_FIREBASE_STORAGE_BUCKET || 'scream-XXXXX.appspot.com',
  messagingSenderId: process.env.REACT_APP_FIREBASE_SENDER_ID || '000000000000',
  appId: process.env.REACT_APP_FIREBASE_APP_ID || '1:000000000000:web:0000000000000000000000',
};

const app = initializeApp(firebaseConfig);
export const rtdb = getDatabase(app);
export const firestore = getFirestore(app);

// Re-export RTDB helpers
export { ref, onValue, set, remove };
