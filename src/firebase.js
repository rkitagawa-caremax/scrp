import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = {
    apiKey: "AIzaSyDPs5rq2ZQZYJA8V4NjAmqAktVZ7c_5TLQ",
    authDomain: "scraipe-system.firebaseapp.com",
    projectId: "scraipe-system",
    storageBucket: "scraipe-system.firebasestorage.app",
    messagingSenderId: "13830868947",
    appId: "1:13830868947:web:ed3dd001ca08fdcae86926"
};

const firebaseApp = initializeApp(firebaseConfig);
export const firestore = getFirestore(firebaseApp);
export default firebaseApp;
