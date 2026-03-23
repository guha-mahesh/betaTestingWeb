// Firebase configuration and initialization
// Configuration is determined dynamically based on Developer Mode environment setting

// Note: This file is loaded synchronously by popup.html
// We need to get the environment configuration from storage
// For initial load, we'll use production as default, but popup.js will handle
// the actual environment switching logic

// Get current environment config - will be called by popup.js
async function getFirebaseConfigForPopup() {
  const env = await getCurrentEnvironment();
  return {
    apiKey: env.firebase.apiKey,
    authDomain: env.firebase.authDomain,
    projectId: env.firebase.projectId,
    storageBucket: env.firebase.storageBucket,
    messagingSenderId: env.firebase.messagingSenderId,
    appId: env.firebase.appId,
    measurementId: env.firebase.measurementId
  };
}

// Default to production for initial sync load (popup.js will override if needed)
const firebaseConfig = {
  apiKey: "AIzaSyB7DIVqzT72Pg9KAhJQCxNgBw7ZeTyLkzc",
  authDomain: "memorymachines-prod.firebaseapp.com",
  projectId: "memorymachines-prod",
  storageBucket: "memorymachines-prod.firebasestorage.app",
  messagingSenderId: "926048236510",
  appId: "1:926048236510:web:15ed4b8a18f757cf9c4932",
  measurementId: "G-5Q7FBXVPWP"
};

// API endpoint for authentication - will be determined by background.js
const AUTH_API_BASE = "https://memorymachines-gateway-prod-btf57kda.uc.gateway.dev";

// Export for use in the extension
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { firebaseConfig, AUTH_API_BASE };
}
