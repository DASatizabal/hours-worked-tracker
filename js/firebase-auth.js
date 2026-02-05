// Firebase Authentication Module for Hours Worked Tracker
// Adapted from alex-expense-tracker

const FirebaseAuth = {
    _app: null,
    _auth: null,
    _user: null,
    _authStateListeners: [],
    _initialized: false,

    isConfigured() {
        return FIREBASE_CONFIG &&
               FIREBASE_CONFIG.apiKey &&
               FIREBASE_CONFIG.apiKey !== 'YOUR_API_KEY' &&
               FIREBASE_CONFIG.projectId &&
               FIREBASE_CONFIG.projectId !== 'YOUR_PROJECT_ID';
    },

    async init() {
        if (this._initialized) {
            return true;
        }

        if (!this.isConfigured()) {
            console.warn('Firebase not configured. Using offline mode.');
            return false;
        }

        try {
            this._app = firebase.initializeApp(FIREBASE_CONFIG);
            this._auth = firebase.auth();

            this._auth.onAuthStateChanged((user) => {
                this._user = user;
                this._notifyListeners(user);
            });

            await this._auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL);
            this._initialized = true;
            return true;
        } catch (error) {
            console.error('Firebase initialization error:', error);
            return false;
        }
    },

    async signIn() {
        if (!this._initialized) {
            console.error('Firebase not initialized');
            return null;
        }

        try {
            const provider = new firebase.auth.GoogleAuthProvider();
            provider.addScope('email');
            provider.addScope('profile');
            const result = await this._auth.signInWithPopup(provider);
            return result.user;
        } catch (error) {
            if (error.code === 'auth/popup-closed-by-user') {
                console.log('Sign-in cancelled by user');
                return null;
            }
            if (error.code === 'auth/popup-blocked') {
                console.error('Popup blocked. Please allow popups for this site.');
                throw new Error('popup-blocked');
            }
            console.error('Sign-in error:', error);
            throw error;
        }
    },

    async signOut() {
        if (!this._initialized || !this._auth) return;
        try {
            await this._auth.signOut();
            this._user = null;
        } catch (error) {
            console.error('Sign-out error:', error);
            throw error;
        }
    },

    onAuthStateChanged(callback) {
        this._authStateListeners.push(callback);
        if (this._initialized) {
            callback(this._user);
        }
        return () => {
            const index = this._authStateListeners.indexOf(callback);
            if (index > -1) this._authStateListeners.splice(index, 1);
        };
    },

    _notifyListeners(user) {
        this._authStateListeners.forEach(callback => {
            try { callback(user); } catch (error) {
                console.error('Auth state listener error:', error);
            }
        });
    },

    getCurrentUser() { return this._user; },
    isSignedIn() { return this._user !== null; },
    getUserDisplayName() {
        if (!this._user) return '';
        return this._user.displayName || this._user.email?.split('@')[0] || 'User';
    },
    getUserFirstName() { return this.getUserDisplayName().split(' ')[0]; },
    getUserPhotoURL() { return this._user?.photoURL || null; },
    getUserEmail() { return this._user?.email || null; },
    getUserId() { return this._user?.uid || null; },

    isPrimaryUser() {
        const email = this.getUserEmail();
        return email && email === AUTH_ROLES.PRIMARY_USER;
    },
    isAdmin() {
        const email = this.getUserEmail();
        return email && AUTH_ROLES.ADMINS.includes(email);
    },
    isKnownUser() { return this.isPrimaryUser() || this.isAdmin(); },

    getUserStoragePrefix() {
        if (this.isKnownUser()) return '';
        const uid = this.getUserId();
        return uid ? `user_${uid}_` : '';
    },

    waitForAuthState() {
        return new Promise((resolve) => {
            if (!this._initialized) { resolve(null); return; }
            const unsubscribe = this._auth.onAuthStateChanged((user) => {
                unsubscribe();
                resolve(user);
            });
        });
    }
};
