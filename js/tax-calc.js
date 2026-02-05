// Tax Calculation Engine for Hours Worked Tracker

const TaxCalc = {
    _taxRate: null,

    getTaxRate() {
        if (this._taxRate !== null) return this._taxRate;
        const saved = localStorage.getItem('hwt_tax_rate');
        this._taxRate = saved ? parseFloat(saved) : CONFIG.DEFAULT_TAX_RATE;
        return this._taxRate;
    },

    setTaxRate(rate) {
        this._taxRate = rate;
        localStorage.setItem('hwt_tax_rate', rate.toString());
    },

    calcTax(gross) {
        return gross * this.getTaxRate();
    },

    calcNet(gross) {
        return gross * (1 - this.getTaxRate());
    },

    calcFromSessions(sessions) {
        const gross = sessions.reduce((sum, s) => sum + (s.earnings || 0), 0);
        return {
            gross,
            tax: this.calcTax(gross),
            net: this.calcNet(gross),
            hours: sessions.reduce((sum, s) => sum + (s.duration || 0), 0)
        };
    },

    // Filter sessions by date range
    filterByDateRange(sessions, startDate, endDate) {
        return sessions.filter(s => {
            const d = s.date;
            return d >= startDate && d <= endDate;
        });
    },

    // Get start of current week (Monday)
    getWeekStart() {
        const now = new Date();
        const day = now.getDay();
        const diff = now.getDate() - day + (day === 0 ? -6 : 1);
        const monday = new Date(now.getFullYear(), now.getMonth(), diff);
        return monday.toISOString().split('T')[0];
    },

    // Get today's date string
    getToday() {
        return new Date().toISOString().split('T')[0];
    },

    // Summary for this week
    thisWeekSummary(sessions) {
        const weekStart = this.getWeekStart();
        const today = this.getToday();
        const filtered = this.filterByDateRange(sessions, weekStart, today);
        return this.calcFromSessions(filtered);
    },

    // Summary for this month
    thisMonthSummary(sessions) {
        const now = new Date();
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
        const today = this.getToday();
        const filtered = this.filterByDateRange(sessions, monthStart, today);
        return this.calcFromSessions(filtered);
    },

    // All-time summary
    allTimeSummary(sessions) {
        return this.calcFromSessions(sessions);
    },

    // Average earnings per week
    avgPerWeek(sessions) {
        if (sessions.length === 0) return 0;
        const dates = sessions.map(s => new Date(s.date)).sort((a, b) => a - b);
        const firstDate = dates[0];
        const lastDate = dates[dates.length - 1];
        const weeks = Math.max(1, (lastDate - firstDate) / (7 * 24 * 60 * 60 * 1000));
        const total = sessions.reduce((sum, s) => sum + (s.earnings || 0), 0);
        return total / weeks;
    }
};
