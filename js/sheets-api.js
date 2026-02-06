// Multi-tab Google Apps Script API with localStorage fallback
// Adapted from alex-expense-tracker for 6-tab architecture

const SheetsAPI = {
    _sessionCache: {},
    _syncStatus: 'synced',
    _lastSyncTime: null,
    _syncListeners: [],

    onSyncStatusChange(callback) {
        this._syncListeners.push(callback);
    },

    _setSyncStatus(status) {
        this._syncStatus = status;
        if (status === 'synced') this._lastSyncTime = new Date();
        this._syncListeners.forEach(cb => cb(status, this._lastSyncTime));
    },

    getSyncStatus() {
        return { status: this._syncStatus, lastSync: this._lastSyncTime };
    },

    isConfigured() {
        const userUrl = this.getUserAppsScriptUrl();
        return (userUrl && userUrl !== '') ||
               (CONFIG.APPS_SCRIPT_URL && CONFIG.APPS_SCRIPT_URL !== 'YOUR_APPS_SCRIPT_URL_HERE');
    },

    getUserAppsScriptUrl() {
        const prefix = this._getStoragePrefix();
        return localStorage.getItem(prefix + 'hwt_apps_script_url') || '';
    },

    setUserAppsScriptUrl(url) {
        const prefix = this._getStoragePrefix();
        if (url) {
            localStorage.setItem(prefix + 'hwt_apps_script_url', url);
        } else {
            localStorage.removeItem(prefix + 'hwt_apps_script_url');
        }
    },

    getActiveAppsScriptUrl() {
        const userUrl = this.getUserAppsScriptUrl();
        return (userUrl && userUrl !== '') ? userUrl : CONFIG.APPS_SCRIPT_URL;
    },

    _getStoragePrefix() {
        if (typeof FirebaseAuth !== 'undefined' && FirebaseAuth.isSignedIn()) {
            return FirebaseAuth.getUserStoragePrefix();
        }
        return '';
    },

    _getStorageKey(key) {
        return this._getStoragePrefix() + key;
    },

    // ============ Generic CRUD ============

    async getAll(tab) {
        if (this.isConfigured() && !CONFIG.USE_LOCAL_STORAGE) {
            return await this._getFromSheets(tab);
        }
        return this._getFromLocalStorage(tab);
    },

    async save(tab, record) {
        const prefixMap = {
            [CONFIG.SHEETS.WORK_SESSIONS]: 'ws_',
            [CONFIG.SHEETS.PAYMENTS]: 'pmt_',
            [CONFIG.SHEETS.GOALS]: 'goal_',
            [CONFIG.SHEETS.GOAL_ALLOCATIONS]: 'alloc_',
            [CONFIG.SHEETS.EMAIL_PAYOUTS]: 'email_',
            [CONFIG.SHEETS.SETTINGS]: 'set_'
        };
        if (!record.id) {
            record.id = (prefixMap[tab] || '') + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        }

        if (this.isConfigured() && !CONFIG.USE_LOCAL_STORAGE) {
            return await this._saveToSheets(tab, record);
        }
        return this._saveToLocalStorage(tab, record);
    },

    async update(tab, id, updates) {
        if (this.isConfigured() && !CONFIG.USE_LOCAL_STORAGE) {
            await this._updateInSheets(tab, id, updates);
        }
        const records = this._getFromLocalStorage(tab);
        const index = records.findIndex(r => r.id === id);
        if (index !== -1) {
            records[index] = { ...records[index], ...updates };
        }
        this._sessionCache[tab] = records;
        this._saveToStorage(tab, records);
        return records[index];
    },

    async remove(tab, id) {
        if (this.isConfigured() && !CONFIG.USE_LOCAL_STORAGE) {
            await this._deleteFromSheets(tab, id);
        }
        const records = this._getFromLocalStorage(tab);
        const filtered = records.filter(r => r.id !== id);
        this._sessionCache[tab] = filtered;
        this._saveToStorage(tab, filtered);
    },

    // ============ Convenience Methods ============

    async getWorkSessions() { return this.getAll(CONFIG.SHEETS.WORK_SESSIONS); },
    async saveWorkSession(session) { return this.save(CONFIG.SHEETS.WORK_SESSIONS, session); },
    async updateWorkSession(id, updates) { return this.update(CONFIG.SHEETS.WORK_SESSIONS, id, updates); },
    async deleteWorkSession(id) { return this.remove(CONFIG.SHEETS.WORK_SESSIONS, id); },

    async getPayments() { return this.getAll(CONFIG.SHEETS.PAYMENTS); },
    async savePayment(payment) { return this.save(CONFIG.SHEETS.PAYMENTS, payment); },
    async updatePayment(id, updates) { return this.update(CONFIG.SHEETS.PAYMENTS, id, updates); },
    async deletePayment(id) { return this.remove(CONFIG.SHEETS.PAYMENTS, id); },

    async getGoals() { return this.getAll(CONFIG.SHEETS.GOALS); },
    async saveGoal(goal) { return this.save(CONFIG.SHEETS.GOALS, goal); },
    async updateGoal(id, updates) { return this.update(CONFIG.SHEETS.GOALS, id, updates); },
    async deleteGoal(id) { return this.remove(CONFIG.SHEETS.GOALS, id); },

    async getGoalAllocations() { return this.getAll(CONFIG.SHEETS.GOAL_ALLOCATIONS); },
    async saveGoalAllocation(alloc) { return this.save(CONFIG.SHEETS.GOAL_ALLOCATIONS, alloc); },
    async deleteGoalAllocation(id) { return this.remove(CONFIG.SHEETS.GOAL_ALLOCATIONS, id); },

    async getEmailPayouts() { return this.getAll(CONFIG.SHEETS.EMAIL_PAYOUTS); },
    async saveEmailPayout(payout) { return this.save(CONFIG.SHEETS.EMAIL_PAYOUTS, payout); },
    async updateEmailPayout(id, updates) { return this.update(CONFIG.SHEETS.EMAIL_PAYOUTS, id, updates); },

    async getSettings() { return this.getAll(CONFIG.SHEETS.SETTINGS); },
    async saveSetting(setting) { return this.save(CONFIG.SHEETS.SETTINGS, setting); },

    async getCruisePayments() { return this.getAll(CONFIG.SHEETS.CRUISE_PAYMENTS); },
    async saveCruisePayment(payment) { return this.save(CONFIG.SHEETS.CRUISE_PAYMENTS, payment); },
    async deleteCruisePayment(id) { return this.remove(CONFIG.SHEETS.CRUISE_PAYMENTS, id); },

    // ============ Google Apps Script Methods ============

    async _getFromSheets(tab) {
        this._setSyncStatus('syncing');
        try {
            const url = this.getActiveAppsScriptUrl() + '?tab=' + encodeURIComponent(tab);
            const response = await fetch(url);
            if (!response.ok) throw new Error('Failed to fetch from Apps Script');
            const data = await response.json();
            if (data.error) throw new Error(data.error);
            this._setSyncStatus('synced');
            const records = data.records || [];
            const localRecords = this._getFromLocalStorage(tab);
            // Don't overwrite local data with empty remote data
            if (records.length > 0 || localRecords.length === 0) {
                this._sessionCache[tab] = records;
                this._saveToStorage(tab, records);
                return records;
            } else {
                console.warn(`Remote returned empty for ${tab} but local has ${localRecords.length} records. Keeping local data.`);
                this._setSyncStatus('offline');
                return localRecords;
            }
        } catch (error) {
            console.error(`Error fetching ${tab} from Apps Script:`, error);
            this._setSyncStatus('offline');
            return this._getFromLocalStorage(tab);
        }
    },

    async _saveToSheets(tab, record) {
        // Always save to localStorage first for reliability
        this._addToLocalStorage(tab, record);

        this._setSyncStatus('syncing');
        try {
            const url = this.getActiveAppsScriptUrl();
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'text/plain' },
                body: JSON.stringify({ action: 'add', tab, record }),
                redirect: 'follow'
            });
            const data = await response.json();
            if (data.error) throw new Error(data.error);
            this._setSyncStatus('synced');
            return record;
        } catch (error) {
            console.error(`Error saving to ${tab}:`, error);
            this._setSyncStatus('offline');
            return record;
        }
    },

    async _updateInSheets(tab, id, updates) {
        this._setSyncStatus('syncing');
        try {
            const url = this.getActiveAppsScriptUrl();
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'text/plain' },
                body: JSON.stringify({ action: 'update', tab, id, updates }),
                redirect: 'follow'
            });
            const data = await response.json();
            if (data.error) throw new Error(data.error);
            this._setSyncStatus('synced');
        } catch (error) {
            console.error(`Error updating in ${tab}:`, error);
            this._setSyncStatus('offline');
        }
    },

    async _deleteFromSheets(tab, id) {
        this._setSyncStatus('syncing');
        try {
            const url = this.getActiveAppsScriptUrl();
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'text/plain' },
                body: JSON.stringify({ action: 'delete', tab, id }),
                redirect: 'follow'
            });
            const data = await response.json();
            if (data.error) throw new Error(data.error);
            this._setSyncStatus('synced');
        } catch (error) {
            console.error(`Error deleting from ${tab}:`, error);
            this._setSyncStatus('offline');
        }
    },

    // ============ LocalStorage Methods ============

    _getFromLocalStorage(tab) {
        if (this._sessionCache[tab]) return this._sessionCache[tab];
        const key = this._getStorageKey('hwt_' + tab);
        const data = localStorage.getItem(key);
        if (data) {
            try {
                const records = JSON.parse(data);
                this._sessionCache[tab] = records;
                return records;
            } catch (e) {
                console.error(`Error parsing localStorage for ${tab}:`, e);
            }
        }
        return [];
    },

    _saveToLocalStorage(tab, record) {
        const records = this._getFromLocalStorage(tab);
        records.push(record);
        this._sessionCache[tab] = records;
        this._saveToStorage(tab, records);
        return record;
    },

    _addToLocalStorage(tab, record) {
        const records = this._getFromLocalStorage(tab);
        records.push(record);
        this._sessionCache[tab] = records;
        this._saveToStorage(tab, records);
    },

    _saveToStorage(tab, records) {
        const key = this._getStorageKey('hwt_' + tab);
        localStorage.setItem(key, JSON.stringify(records));
    },

    clearSession() {
        this._sessionCache = {};
    },

    // ============ CSV Export ============

    exportWorkSessionsCSV() {
        const sessions = this._getFromLocalStorage(CONFIG.SHEETS.WORK_SESSIONS);
        if (sessions.length === 0) { alert('No work sessions to export.'); return; }
        const headers = ['Date', 'Start Time', 'End Time', 'Duration (hrs)', 'Type', 'Project ID', 'Hourly Rate', 'Earnings', 'Notes', 'ID'];
        const rows = sessions.map(s => [
            s.date, s.startTime || '', s.endTime || '', s.duration,
            s.type, s.projectId || '', s.hourlyRate, s.earnings,
            s.notes || '', s.id
        ]);
        this._downloadCSV('work_sessions', headers, rows);
    },

    exportPaymentsCSV() {
        const payments = this._getFromLocalStorage(CONFIG.SHEETS.PAYMENTS);
        if (payments.length === 0) { alert('No payments to export.'); return; }
        const headers = ['Amount', 'Tax', 'Net', 'Type', 'Status', 'Submitted At', 'Payout Expected', 'Paid Out At', 'DA Payment ID', 'ID'];
        const rows = payments.map(p => [
            p.amount, p.tax, p.netAmount, p.type, p.status,
            p.submittedAt, p.payoutExpectedAt || '', p.paidOutAt || '',
            p.daPaymentId || '', p.id
        ]);
        this._downloadCSV('payments', headers, rows);
    },

    exportTaxSummaryCSV() {
        const sessions = this._getFromLocalStorage(CONFIG.SHEETS.WORK_SESSIONS);
        if (sessions.length === 0) { alert('No data to export.'); return; }
        const summary = TaxCalc.allTimeSummary(sessions);
        const headers = ['Metric', 'Value'];
        const rows = [
            ['Total Gross Earnings', summary.gross.toFixed(2)],
            ['Total Tax (35%)', summary.tax.toFixed(2)],
            ['Total Net Earnings', summary.net.toFixed(2)],
            ['Total Hours Worked', summary.hours.toFixed(1)],
            ['Average $/Week', TaxCalc.avgPerWeek(sessions).toFixed(2)]
        ];
        this._downloadCSV('tax_summary', headers, rows);
    },

    _downloadCSV(name, headers, rows) {
        const csv = [headers, ...rows]
            .map(row => row.map(cell => `"${cell}"`).join(','))
            .join('\n');
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `hwt_${name}_${new Date().toISOString().split('T')[0]}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    }
};
