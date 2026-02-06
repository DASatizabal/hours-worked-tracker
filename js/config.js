// Configuration for Hours Worked Tracker

const APP_VERSION = '1.5.8';

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
  apiKey: "AIzaSyC2-gDSzWUnmxHvCgljdyMbpTZXfQfb-iM",
  authDomain: "hours-worked-tracker-3d83d.firebaseapp.com",
  projectId: "hours-worked-tracker-3d83d",
  storageBucket: "hours-worked-tracker-3d83d.firebasestorage.app",
  messagingSenderId: "83325546236",
  appId: "1:83325546236:web:ae6ba4a4fb167e4284f179"
};

const CONFIG = {
    // Google Apps Script URL
    APPS_SCRIPT_URL: 'https://script.google.com/macros/s/AKfycbwFi9cuw95DbW6sb2_z8FJe2zcSiXPlIOD_i1VZPDh7P5LhYpUNddIG25VAeYX82aR3yQ/exec',

    // Set to true to use localStorage only (offline mode)
    USE_LOCAL_STORAGE: false,

    // Default settings
    DEFAULT_HOURLY_RATE: 20,
    DEFAULT_TAX_RATE: 0.35,

    // Payment pipeline timing (in hours)
    PROJECT_PAYOUT_HOURS: 168,  // 7 days
    TASK_PAYOUT_HOURS: 72,      // 3 days
    PAYPAL_TRANSFER_BUSINESS_DAYS: 3,

    // Sheet tab names
    SHEETS: {
        WORK_SESSIONS: 'WorkSessions',
        PAYMENTS: 'Payments',
        GOALS: 'Goals',
        GOAL_ALLOCATIONS: 'GoalAllocations',
        EMAIL_PAYOUTS: 'EmailPayouts',
        CRUISE_PAYMENTS: 'CruisePayments',
        SETTINGS: 'Settings'
    }
};
