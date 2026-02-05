// Configuration for Hours Worked Tracker

const APP_VERSION = '1.0.0';

// Auth roles
const AUTH_ROLES = {
    PRIMARY_USER: 'dasatizabal@gmail.com',
    ADMINS: ['dasatizabal@gmail.com']
};

// Firebase Configuration
// To set up:
// 1. Go to https://console.firebase.google.com
// 2. Create new project: "hours-worked-tracker"
// 3. Enable Google Auth: Authentication > Sign-in method > Google > Enable
// 4. Add authorized domain
// 5. Get config: Project settings > Your apps > Add web app
const FIREBASE_CONFIG = {
    apiKey: "YOUR_API_KEY",
    authDomain: "YOUR_PROJECT.firebaseapp.com",
    projectId: "YOUR_PROJECT_ID",
    storageBucket: "YOUR_PROJECT.firebasestorage.app",
    messagingSenderId: "YOUR_SENDER_ID",
    appId: "YOUR_APP_ID"
};

const CONFIG = {
    // Google Apps Script URL
    APPS_SCRIPT_URL: 'YOUR_APPS_SCRIPT_URL_HERE',

    // Set to true to use localStorage only (offline mode)
    USE_LOCAL_STORAGE: true,

    // Default settings
    DEFAULT_HOURLY_RATE: 20,
    DEFAULT_TAX_RATE: 0.35,

    // Payment pipeline timing (in hours)
    PROJECT_PAYOUT_HOURS: 187,  // 7 days + 19 hours
    TASK_PAYOUT_HOURS: 72,      // 3 days
    PAYPAL_TRANSFER_BUSINESS_DAYS: 3,

    // Sheet tab names
    SHEETS: {
        WORK_SESSIONS: 'WorkSessions',
        PAYMENTS: 'Payments',
        GOALS: 'Goals',
        GOAL_ALLOCATIONS: 'GoalAllocations',
        EMAIL_PAYOUTS: 'EmailPayouts',
        SETTINGS: 'Settings'
    }
};
