// Firebase Configuration
const firebaseConfig = {
   apiKey: "AIzaSyDzDRaHEASBWO0dDKOIlvlku3lN01b89iw",
    authDomain: "alvin-f573e.firebaseapp.com",
    projectId: "alvin-f573e",
    storageBucket: "alvin-f573e.firebasestorage.app",
    messagingSenderId: "718704784181",
    appId: "1:718704784181:web:db5fe912a3cb3b0675d27c",
    measurementId: "G-NHLWBMV307",
    databaseURL: "https://alvin-f573e-default-rtdb.asia-southeast1.firebasedatabase.app"
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);

// Export untuk digunakan di file lain
const auth = firebase.auth();
const database = firebase.database();
