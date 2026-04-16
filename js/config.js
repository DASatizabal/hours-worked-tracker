// Configuration for Hours Worked Tracker

const APP_VERSION = '2.0.30';

// Auth roles
const AUTH_ROLES = {
    PRIMARY_USER: 'dasatizabal@gmail.com',
    ADMINS: ['dasatizabal@gmail.com'],
    FAMILY: ['dasatizabal@gmail.com', 'Lisasatizabal@gmail.com']
};

// Display names for family members (used in family view badges)
const USER_DISPLAY_NAMES = {
    'dasatizabal@gmail.com': 'David',
    'lisasatizabal@gmail.com': 'Lisa'
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
    REFERRAL_PAYOUT_HOURS: 48,  // 2 days
    BONUS_PAYOUT_HOURS: 168,    // 7 days
    PAYPAL_TRANSFER_BUSINESS_DAYS: 3,
    DEFAULT_PAYOUT_WEEKDAY: 2,  // 0=Sunday, 1=Monday, 2=Tuesday (default), etc.
    DEFAULT_AUTO_PAYOUT_ENABLED: false,
    DEFAULT_PAYOUT_HOUR: 12,
    DEFAULT_PAYOUT_AMPM: 'PM',

    // Polling interval for automatic scan detection (milliseconds)
    POLL_INTERVAL_MS: 5 * 60 * 1000,  // 5 minutes

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
