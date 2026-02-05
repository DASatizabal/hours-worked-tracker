// Main Application Logic for Hours Worked Tracker

const App = {
    _workType: 'project', // 'project' or 'task'
    _submitting: false, // Prevent double-clicks

    // Lock/unlock submit buttons during async operations
    setSubmitting(form, busy) {
        this._submitting = busy;
        const btn = form?.querySelector('button[type="submit"]');
        if (btn) {
            btn.disabled = busy;
            if (busy) {
                btn.dataset.originalText = btn.textContent;
                btn.textContent = 'Saving...';
                btn.classList.add('opacity-50', 'cursor-not-allowed');
            } else {
                btn.textContent = btn.dataset.originalText || btn.textContent;
                btn.classList.remove('opacity-50', 'cursor-not-allowed');
            }
        }
    },

    // ============ Initialization ============

    async init() {
        this.initTheme();
        this.initVersion();
        this.bindEvents();
        this.loadSettings();

        // Try Firebase auth
        const firebaseReady = await FirebaseAuth.init();
        if (firebaseReady) {
            this.showLoading(true);
            FirebaseAuth.onAuthStateChanged((user) => {
                this.showLoading(false);
                if (user) {
                    this.onSignedIn(user);
                } else {
                    this.onSignedOut();
                }
            });
        } else {
            // Offline mode - skip auth
            this.hideAuthModal();
            await this.loadData();
        }

        // Sync status indicator
        SheetsAPI.onSyncStatusChange((status) => this.updateSyncIndicator(status));
    },

    async onSignedIn(user) {
        this.hideAuthModal();
        document.getElementById('user-info').classList.remove('hidden');
        document.getElementById('user-info').classList.add('flex');
        const avatar = document.getElementById('user-avatar');
        const name = document.getElementById('user-name');
        if (user.photoURL) avatar.src = user.photoURL;
        name.textContent = FirebaseAuth.getUserFirstName();

        await this.loadData();
    },

    onSignedOut() {
        document.getElementById('user-info').classList.add('hidden');
        document.getElementById('user-info').classList.remove('flex');
        SheetsAPI.clearSession();
        this.showAuthModal();
    },

    async loadData() {
        this.showLoading(true);
        try {
            const sessions = await SheetsAPI.getWorkSessions();
            const payments = await SheetsAPI.getPayments();

            // Auto-advance pipeline
            if (Pipeline.autoAdvance(payments)) {
                for (const p of payments) {
                    await SheetsAPI.updatePayment(p.id, { status: p.status });
                }
            }

            this.renderDashboard(sessions, payments);
            this.renderSessionsTable(sessions);
            Pipeline.renderPipeline(payments);
            await Goals.renderGoals();
        } catch (error) {
            console.error('Error loading data:', error);
            this.showToast('Error loading data', 'error');
        }
        this.showLoading(false);
        if (typeof lucide !== 'undefined') lucide.createIcons();
    },

    // ============ Theme ============

    initTheme() {
        const savedTheme = localStorage.getItem('hwt_theme');
        const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;

        if (savedTheme === 'light' || (!savedTheme && !prefersDark)) {
            document.body.classList.add('light-mode');
            this.updateThemeIcon(false);
        } else {
            document.body.classList.remove('light-mode');
            this.updateThemeIcon(true);
        }
    },

    toggleTheme() {
        const isLight = document.body.classList.toggle('light-mode');
        localStorage.setItem('hwt_theme', isLight ? 'light' : 'dark');
        this.updateThemeIcon(!isLight);
    },

    updateThemeIcon(isDark) {
        const btn = document.getElementById('theme-toggle');
        if (btn) {
            btn.innerHTML = `<i data-lucide="${isDark ? 'moon' : 'sun'}" class="w-4 h-4 text-slate-500 group-hover:text-violet-400"></i>`;
            if (typeof lucide !== 'undefined') lucide.createIcons();
        }
    },

    // ============ Version ============

    initVersion() {
        const tag = document.getElementById('version-tag');
        if (tag) tag.textContent = 'v' + APP_VERSION;
    },

    // ============ Event Binding ============

    bindEvents() {
        // Theme
        document.getElementById('theme-toggle')?.addEventListener('click', () => this.toggleTheme());

        // Auth
        document.getElementById('google-sign-in-btn')?.addEventListener('click', () => this.handleSignIn());
        document.getElementById('sign-out-btn')?.addEventListener('click', () => this.handleSignOut());
        document.getElementById('skip-auth-btn')?.addEventListener('click', () => {
            this.hideAuthModal();
            this.loadData();
        });

        // Log session
        document.getElementById('log-session-btn')?.addEventListener('click', () => this.openSessionModal());
        document.getElementById('close-session-modal')?.addEventListener('click', () => this.closeModal('session-modal'));
        document.getElementById('session-modal-backdrop')?.addEventListener('click', () => this.closeModal('session-modal'));
        document.getElementById('session-form')?.addEventListener('submit', (e) => this.handleSessionSubmit(e));

        // Work type toggle
        document.getElementById('type-project-btn')?.addEventListener('click', () => this.setWorkType('project'));
        document.getElementById('type-task-btn')?.addEventListener('click', () => this.setWorkType('task'));

        // Auto-calculate hourly rate on input change
        document.getElementById('session-amount')?.addEventListener('input', () => this.updateCalcRate());
        document.getElementById('session-hours')?.addEventListener('input', () => this.updateCalcRate());
        document.getElementById('session-minutes')?.addEventListener('input', () => this.updateCalcRate());

        // Payment modal
        document.getElementById('close-payment-modal')?.addEventListener('click', () => this.closeModal('payment-modal'));
        document.getElementById('payment-modal-backdrop')?.addEventListener('click', () => this.closeModal('payment-modal'));
        document.getElementById('payment-form')?.addEventListener('submit', (e) => this.handlePaymentSubmit(e));

        // Goal modal
        document.getElementById('create-goal-btn')?.addEventListener('click', () => this.openGoalModal());
        document.getElementById('close-goal-modal')?.addEventListener('click', () => this.closeModal('goal-modal'));
        document.getElementById('goal-modal-backdrop')?.addEventListener('click', () => this.closeModal('goal-modal'));
        document.getElementById('goal-form')?.addEventListener('submit', (e) => this.handleGoalSubmit(e));

        // Icon picker
        this.initIconPicker();

        // Allocate modal
        document.getElementById('close-allocate-modal')?.addEventListener('click', () => this.closeModal('allocate-modal'));
        document.getElementById('allocate-modal-backdrop')?.addEventListener('click', () => this.closeModal('allocate-modal'));
        document.getElementById('allocate-form')?.addEventListener('submit', (e) => this.handleAllocateSubmit(e));

        // Settings
        document.getElementById('settings-btn')?.addEventListener('click', () => this.openSettingsModal());
        document.getElementById('close-settings-modal')?.addEventListener('click', () => this.closeModal('settings-modal'));
        document.getElementById('settings-modal-backdrop')?.addEventListener('click', () => this.closeModal('settings-modal'));
        document.getElementById('settings-save-btn')?.addEventListener('click', () => this.saveSettings());

        // Pipeline toggle
        document.getElementById('toggle-pipeline-details')?.addEventListener('click', () => this.togglePipelineDetails());

        // Exports
        document.getElementById('export-sessions-btn')?.addEventListener('click', () => SheetsAPI.exportWorkSessionsCSV());
        document.getElementById('export-sessions-csv')?.addEventListener('click', () => SheetsAPI.exportWorkSessionsCSV());
        document.getElementById('export-payments-csv')?.addEventListener('click', () => SheetsAPI.exportPaymentsCSV());
        document.getElementById('export-tax-csv')?.addEventListener('click', () => SheetsAPI.exportTaxSummaryCSV());

        // Scan emails
        document.getElementById('scan-emails-btn')?.addEventListener('click', () => this.scanEmails());
    },

    // ============ Auth ============

    async handleSignIn() {
        try {
            const user = await FirebaseAuth.signIn();
            if (!user) return;
        } catch (error) {
            const errEl = document.getElementById('auth-error');
            const errText = document.getElementById('auth-error-text');
            if (errEl && errText) {
                errText.textContent = error.message === 'popup-blocked'
                    ? 'Popup blocked. Please allow popups for this site.'
                    : 'Sign-in failed. Please try again.';
                errEl.classList.remove('hidden');
            }
        }
    },

    async handleSignOut() {
        await FirebaseAuth.signOut();
    },

    showAuthModal() {
        if (!FirebaseAuth.isConfigured()) return;
        document.getElementById('auth-modal').classList.remove('hidden');
        document.getElementById('auth-modal').classList.add('flex');
    },

    hideAuthModal() {
        document.getElementById('auth-modal').classList.add('hidden');
        document.getElementById('auth-modal').classList.remove('flex');
    },

    // ============ Dashboard Rendering ============

    renderDashboard(sessions, payments) {
        // Total amount to be paid = all earnings - payments that reached "in_bank"
        const totalEarnings = sessions.reduce((sum, s) => sum + (parseFloat(s.earnings) || 0), 0);
        const inBankTotal = (payments || [])
            .filter(p => p.status === 'in_bank')
            .reduce((sum, p) => sum + (parseFloat(p.amount) || 0), 0);
        const unpaid = totalEarnings - inBankTotal;
        const totalHours = sessions.reduce((sum, s) => sum + (parseFloat(s.duration) || 0), 0);

        document.getElementById('week-earnings').textContent = '$' + Math.max(0, unpaid).toFixed(2);
        document.getElementById('week-hours').textContent = totalHours.toFixed(1) + ' hours worked';
        document.getElementById('week-tax').textContent = '$' + TaxCalc.calcTax(Math.max(0, unpaid)).toFixed(2);
        document.getElementById('week-net').textContent = 'Net: $' + TaxCalc.calcNet(Math.max(0, unpaid)).toFixed(2);
        const taxLabel = document.getElementById('tax-card-label');
        if (taxLabel) taxLabel.textContent = `Tax to Set Aside (${Math.round(TaxCalc.getTaxRate() * 100)}%)`;

        // All time stats
        const allTime = TaxCalc.allTimeSummary(sessions);
        document.getElementById('stat-gross').textContent = '$' + allTime.gross.toFixed(2);
        document.getElementById('stat-tax').textContent = '$' + allTime.tax.toFixed(2);
        document.getElementById('stat-net').textContent = '$' + allTime.net.toFixed(2);
        document.getElementById('stat-avg-week').textContent = '$' + TaxCalc.avgPerWeek(sessions).toFixed(2);
    },

    // ============ Sessions Table ============

    renderSessionsTable(sessions) {
        const tbody = document.getElementById('sessions-table-body');
        const empty = document.getElementById('sessions-empty');
        if (!tbody) return;

        // Sort by submittedAt descending (newest first)
        const sorted = [...sessions].sort((a, b) => (b.submittedAt || '').localeCompare(a.submittedAt || ''));

        if (sorted.length === 0) {
            tbody.innerHTML = '';
            if (empty) empty.classList.remove('hidden');
            return;
        }

        if (empty) empty.classList.add('hidden');

        tbody.innerHTML = sorted.map(s => `
            <tr class="hover:bg-white/5 transition-colors">
                <td class="px-4 py-3 text-sm text-white">${this.formatDate(s.date)}</td>
                <td class="px-4 py-3 text-sm">
                    <span class="px-2 py-0.5 rounded-full text-xs font-medium ${s.type === 'project' ? 'bg-violet-500/20 text-violet-400' : 'bg-cyan-500/20 text-cyan-400'}">${s.type === 'project' ? 'Project' : 'Task'}</span>
                </td>
                <td class="px-4 py-3 text-sm text-right text-white">${parseFloat(s.duration) > 0 ? parseFloat(s.duration).toFixed(2) + 'h' : '-'}</td>
                <td class="px-4 py-3 text-sm text-right font-medium text-emerald-400">$${parseFloat(s.earnings).toFixed(2)}</td>
                <td class="px-4 py-3 text-sm text-slate-400">${s.projectId || '-'}</td>
                <td class="px-4 py-3 text-sm text-slate-400 max-w-[200px] truncate">${s.notes || '-'}</td>
                <td class="px-4 py-3 text-center">
                    <div class="flex items-center justify-center gap-1">
                        <button class="p-1 hover:bg-white/10 rounded transition-colors" onclick="App.editSession('${s.id}')" title="Edit">
                            <i data-lucide="pencil" class="w-3.5 h-3.5 text-slate-500 hover:text-violet-400"></i>
                        </button>
                        <button class="p-1 hover:bg-white/10 rounded transition-colors" onclick="App.deleteSession('${s.id}')" title="Delete">
                            <i data-lucide="trash-2" class="w-3.5 h-3.5 text-slate-500 hover:text-red-400"></i>
                        </button>
                    </div>
                </td>
            </tr>
        `).join('');

        if (typeof lucide !== 'undefined') lucide.createIcons();
    },

    // ============ Work Session Modal ============

    async openSessionModal(editId) {
        const modal = document.getElementById('session-modal');
        const title = document.getElementById('session-modal-title');
        const form = document.getElementById('session-form');

        form.reset();
        document.getElementById('session-edit-id').value = '';

        // Show modal immediately (before any async work)
        modal.classList.remove('hidden');
        modal.classList.add('flex');

        if (editId) {
            title.textContent = 'Edit Work Session';
            // Show loading state on submit button while data loads
            const btn = form.querySelector('button[type="submit"]');
            if (btn) {
                btn.disabled = true;
                btn.dataset.originalText = btn.textContent;
                btn.textContent = 'Loading...';
                btn.classList.add('opacity-50', 'cursor-not-allowed');
            }
            await this.populateSessionForm(editId);
            // Restore button after data loads
            if (btn) {
                btn.disabled = false;
                btn.textContent = btn.dataset.originalText || 'Save Session';
                btn.classList.remove('opacity-50', 'cursor-not-allowed');
            }
        } else {
            title.textContent = 'Log Work Session';
            document.getElementById('session-date').value = new Date().toISOString().split('T')[0];
            this.setWorkType('project');
        }
    },

    async populateSessionForm(id) {
        const sessions = await SheetsAPI.getWorkSessions();
        const session = sessions.find(s => s.id === id);
        if (!session) return;

        document.getElementById('session-edit-id').value = id;
        document.getElementById('session-date').value = session.date;
        document.getElementById('session-project-id').value = session.projectId || '';
        document.getElementById('session-notes').value = session.notes || '';
        document.getElementById('session-amount').value = session.earnings || '';

        const type = session.type || 'project';
        this.setWorkType(type);

        if (type === 'project' && session.duration) {
            const totalMinutes = Math.round(parseFloat(session.duration) * 60);
            const hours = Math.floor(totalMinutes / 60);
            const minutes = totalMinutes % 60;
            document.getElementById('session-hours').value = hours;
            document.getElementById('session-minutes').value = minutes;
        }

        this.updateCalcRate();
    },

    setWorkType(type) {
        this._workType = type;
        const timeGroup = document.getElementById('time-worked-group');
        const rateDisplay = document.getElementById('hourly-rate-display');
        const projectBtn = document.getElementById('type-project-btn');
        const taskBtn = document.getElementById('type-task-btn');

        if (type === 'project') {
            timeGroup.classList.remove('hidden');
            rateDisplay.classList.remove('hidden');
            projectBtn.classList.add('bg-violet-600', 'text-white');
            projectBtn.classList.remove('bg-white/10', 'text-slate-400');
            taskBtn.classList.remove('bg-violet-600', 'text-white');
            taskBtn.classList.add('bg-white/10', 'text-slate-400');
        } else {
            timeGroup.classList.add('hidden');
            rateDisplay.classList.add('hidden');
            taskBtn.classList.add('bg-violet-600', 'text-white');
            taskBtn.classList.remove('bg-white/10', 'text-slate-400');
            projectBtn.classList.remove('bg-violet-600', 'text-white');
            projectBtn.classList.add('bg-white/10', 'text-slate-400');
        }
        this.updateCalcRate();
    },

    updateCalcRate() {
        const rateEl = document.getElementById('calc-hourly-rate');
        if (!rateEl) return;

        const amount = parseFloat(document.getElementById('session-amount')?.value) || 0;
        const hours = parseInt(document.getElementById('session-hours')?.value) || 0;
        const minutes = parseInt(document.getElementById('session-minutes')?.value) || 0;
        const totalHours = hours + minutes / 60;

        if (totalHours > 0 && amount > 0) {
            rateEl.textContent = '$' + (amount / totalHours).toFixed(2) + '/hr';
        } else {
            rateEl.textContent = '$0.00/hr';
        }
    },

    async handleSessionSubmit(e) {
        e.preventDefault();
        if (this._submitting) return;

        const form = document.getElementById('session-form');
        const editId = document.getElementById('session-edit-id').value;
        const date = document.getElementById('session-date').value;
        const type = this._workType;
        const earnings = parseFloat(document.getElementById('session-amount').value);
        const projectId = document.getElementById('session-project-id').value.trim();
        const notes = document.getElementById('session-notes').value.trim();

        if (!earnings || earnings <= 0) {
            this.showToast('Please enter the amount paid', 'error');
            return;
        }

        let duration = 0;
        let hourlyRate = 0;

        if (type === 'project') {
            const hours = parseInt(document.getElementById('session-hours').value) || 0;
            const minutes = parseInt(document.getElementById('session-minutes').value) || 0;
            duration = hours + minutes / 60;

            if (duration <= 0) {
                this.showToast('Please enter time worked', 'error');
                return;
            }

            hourlyRate = earnings / duration;
        }

        const session = {
            date, startTime: '', endTime: '',
            duration, type, projectId, notes, hourlyRate, earnings,
            submittedAt: new Date().toISOString()
        };

        this.setSubmitting(form, true);
        this.closeModal('session-modal');

        try {
            if (editId) {
                await SheetsAPI.updateWorkSession(editId, session);
                this.showToast('Session updated', 'success');
            } else {
                await SheetsAPI.saveWorkSession(session);
                this.showToast('Session logged! $' + earnings.toFixed(2) + ' earned', 'success');
            }
            await this.loadData();
        } catch (error) {
            console.error('Error saving session:', error);
            this.showToast('Error saving session', 'error');
        }
        this.setSubmitting(form, false);
    },

    async editSession(id) {
        await this.openSessionModal(id);
    },

    async deleteSession(id) {
        if (!confirm('Delete this work session?')) return;

        // Immediate visual feedback: fade the row
        const row = document.querySelector(`button[onclick="App.deleteSession('${id}')"]`)?.closest('tr');
        if (row) {
            row.style.opacity = '0.4';
            row.style.pointerEvents = 'none';
        }
        this.showToast('Deleting session...', 'info');

        try {
            await SheetsAPI.deleteWorkSession(id);
            this.showToast('Session deleted', 'success');
            await this.loadData();
        } catch (error) {
            // Restore the row if delete failed
            if (row) {
                row.style.opacity = '1';
                row.style.pointerEvents = '';
            }
            this.showToast('Error deleting session', 'error');
        }
    },

    // ============ Payment Modal ============

    async openPaymentModal(editId) {
        const modal = document.getElementById('payment-modal');
        const title = document.getElementById('payment-modal-title');
        const form = document.getElementById('payment-form');
        form.reset();
        document.getElementById('payment-edit-id').value = '';

        // Populate session checkboxes
        const sessions = await SheetsAPI.getWorkSessions();
        const payments = await SheetsAPI.getPayments();
        const usedSessionIds = new Set();
        payments.forEach(p => {
            if (p.workSessionIds) {
                p.workSessionIds.split(',').forEach(id => usedSessionIds.add(id.trim()));
            }
        });

        const sessionList = document.getElementById('payment-session-list');
        const unassigned = sessions.filter(s => !usedSessionIds.has(s.id));

        if (unassigned.length === 0) {
            sessionList.innerHTML = '<p class="text-xs text-slate-500 p-2">All sessions are already assigned to payments.</p>';
        } else {
            sessionList.innerHTML = unassigned.map(s => `
                <label class="flex items-center gap-2 p-2 rounded-lg hover:bg-white/5 cursor-pointer">
                    <input type="checkbox" class="payment-session-cb rounded" value="${s.id}" data-amount="${s.earnings}" data-type="${s.type}">
                    <span class="text-sm text-white">${this.formatDate(s.date)} - ${s.duration}h - $${parseFloat(s.earnings).toFixed(2)} (${s.type})</span>
                </label>
            `).join('');

            // Auto-calculate amount when checkboxes change
            sessionList.querySelectorAll('.payment-session-cb').forEach(cb => {
                cb.addEventListener('change', () => {
                    const checked = sessionList.querySelectorAll('.payment-session-cb:checked');
                    let total = 0;
                    checked.forEach(c => { total += parseFloat(c.dataset.amount); });
                    document.getElementById('payment-amount').value = total.toFixed(2);
                    // Set type based on majority
                    const types = Array.from(checked).map(c => c.dataset.type);
                    if (types.length > 0) {
                        const projectCount = types.filter(t => t === 'project').length;
                        document.getElementById('payment-type').value = projectCount >= types.length / 2 ? 'project' : 'task';
                    }
                });
            });
        }

        if (editId) {
            title.textContent = 'Edit Payment';
            await this.populatePaymentForm(editId);
        } else {
            title.textContent = 'Create Payment';
        }

        modal.classList.remove('hidden');
        modal.classList.add('flex');
    },

    async populatePaymentForm(id) {
        const payments = await SheetsAPI.getPayments();
        const payment = payments.find(p => p.id === id);
        if (!payment) return;

        document.getElementById('payment-edit-id').value = id;
        document.getElementById('payment-amount').value = payment.amount;
        document.getElementById('payment-type').value = payment.type;
        document.getElementById('payment-status').value = payment.status;
        document.getElementById('payment-notes').value = payment.notes || '';
    },

    async handlePaymentSubmit(e) {
        e.preventDefault();
        if (this._submitting) return;

        const form = document.getElementById('payment-form');
        const editId = document.getElementById('payment-edit-id').value;
        const amount = parseFloat(document.getElementById('payment-amount').value);
        const type = document.getElementById('payment-type').value;
        const status = document.getElementById('payment-status').value;
        const notes = document.getElementById('payment-notes').value.trim();

        if (!amount || amount <= 0) {
            this.showToast('Please enter a valid amount', 'error');
            return;
        }

        // Capture session IDs before closing modal
        const checked = document.querySelectorAll('.payment-session-cb:checked');
        const sessionIds = Array.from(checked).map(cb => cb.value);

        this.setSubmitting(form, true);
        this.closeModal('payment-modal');

        try {
            if (editId) {
                await SheetsAPI.updatePayment(editId, {
                    amount, type, status, notes,
                    tax: TaxCalc.calcTax(amount),
                    netAmount: TaxCalc.calcNet(amount)
                });
                this.showToast('Payment updated', 'success');
            } else {
                const payment = Pipeline.createPayment(sessionIds, amount, type);
                payment.status = status;
                payment.notes = notes;
                await SheetsAPI.savePayment(payment);
                this.showToast('Payment created', 'success');
            }
            await this.loadData();
        } catch (error) {
            console.error('Error saving payment:', error);
            this.showToast('Error saving payment', 'error');
        }
        this.setSubmitting(form, false);
    },

    async advancePayment(id) {
        const payments = await SheetsAPI.getPayments();
        const payment = payments.find(p => p.id === id);
        if (!payment) return;

        const currentIndex = Pipeline.STAGES.indexOf(payment.status);
        if (currentIndex >= Pipeline.STAGES.length - 1) return;

        const nextStatus = Pipeline.STAGES[currentIndex + 1];
        Pipeline.advancePayment(payment, nextStatus);

        try {
            await SheetsAPI.updatePayment(id, payment);
            this.showToast(`Payment advanced to ${Pipeline.STAGE_LABELS[nextStatus]}`, 'success');
            await this.loadData();
        } catch (error) {
            this.showToast('Error advancing payment', 'error');
        }
    },

    async editPayment(id) {
        await this.openPaymentModal(id);
    },

    // ============ Icon Picker ============

    initIconPicker() {
        const ICONS = [
            '🎯', '✈️', '🚢', '🏖️', '🎮', '💻', '📱', '🚗', '🏠', '🎓',
            '💰', '💎', '🎁', '🎉', '🏆', '⭐', '❤️', '🔥', '🌟', '🎵',
            '📚', '🛒', '👶', '🐕', '🏋️', '🎬', '🍕', '☕', '🌴', '🎄',
            '💼', '🔧', '📷', '🎨', '🏥', '🎹', '⚽', '🎲', '🧳', '🛫',
            '💡', '🔑', '🎤', '🏰', '🌊', '🍎', '🎸', '🚀'
        ];

        const grid = document.getElementById('icon-picker-grid');
        const btn = document.getElementById('icon-picker-btn');
        const input = document.getElementById('goal-icon');
        if (!grid || !btn || !input) return;

        // Populate grid
        grid.innerHTML = ICONS.map(icon =>
            `<button type="button" class="icon-pick-item p-2 text-xl rounded-lg hover:bg-white/10 transition-colors text-center" data-icon="${icon}">${icon}</button>`
        ).join('');

        // Toggle grid
        btn.addEventListener('click', () => {
            grid.classList.toggle('hidden');
        });

        // Select icon
        grid.addEventListener('click', (e) => {
            const item = e.target.closest('.icon-pick-item');
            if (!item) return;
            const icon = item.dataset.icon;
            input.value = icon;
            btn.textContent = icon;
            grid.classList.add('hidden');
        });

        // Close grid when clicking outside
        document.addEventListener('click', (e) => {
            if (!e.target.closest('#icon-picker-grid') && !e.target.closest('#icon-picker-btn')) {
                grid.classList.add('hidden');
            }
        });
    },

    // ============ Goal Modal ============

    openGoalModal(editId) {
        const modal = document.getElementById('goal-modal');
        const title = document.getElementById('goal-modal-title');
        const form = document.getElementById('goal-form');
        form.reset();
        document.getElementById('goal-edit-id').value = '';
        // Reset icon picker to default
        document.getElementById('goal-icon').value = '🎯';
        document.getElementById('icon-picker-btn').textContent = '🎯';

        if (editId) {
            title.textContent = 'Edit Savings Goal';
            this.populateGoalForm(editId);
        } else {
            title.textContent = 'Create Savings Goal';
        }

        modal.classList.remove('hidden');
        modal.classList.add('flex');
    },

    async populateGoalForm(id) {
        const goals = await SheetsAPI.getGoals();
        const goal = goals.find(g => g.id === id);
        if (!goal) return;

        document.getElementById('goal-edit-id').value = id;
        document.getElementById('goal-name').value = goal.name;
        document.getElementById('goal-icon').value = goal.icon || '🎯';
        document.getElementById('icon-picker-btn').textContent = goal.icon || '🎯';
        document.getElementById('goal-target').value = goal.targetAmount;
    },

    async handleGoalSubmit(e) {
        e.preventDefault();
        if (this._submitting) return;

        const form = document.getElementById('goal-form');
        const editId = document.getElementById('goal-edit-id').value;
        const name = document.getElementById('goal-name').value.trim();
        const icon = document.getElementById('goal-icon').value.trim() || '🎯';
        const targetAmount = parseFloat(document.getElementById('goal-target').value);

        if (!name || !targetAmount) {
            this.showToast('Please fill in all fields', 'error');
            return;
        }

        this.setSubmitting(form, true);
        this.closeModal('goal-modal');

        try {
            if (editId) {
                await SheetsAPI.updateGoal(editId, { name, icon, targetAmount });
                this.showToast('Goal updated', 'success');
            } else {
                await SheetsAPI.saveGoal({
                    name, icon, targetAmount,
                    savedAmount: 0,
                    createdAt: new Date().toISOString(),
                    completedAt: ''
                });
                this.showToast('Goal created!', 'success');
            }
            await Goals.renderGoals();
        } catch (error) {
            this.showToast('Error saving goal', 'error');
        }
        this.setSubmitting(form, false);
    },

    async editGoal(id) {
        this.openGoalModal(id);
        await this.populateGoalForm(id);
    },

    async deleteGoal(id) {
        if (!confirm('Delete this savings goal? This will also remove all allocations.')) return;
        this.showToast('Deleting goal...', 'info');
        try {
            const allocations = await SheetsAPI.getGoalAllocations();
            const goalAllocs = allocations.filter(a => a.goalId === id);
            await Promise.all(goalAllocs.map(a => SheetsAPI.deleteGoalAllocation(a.id)));
            await SheetsAPI.deleteGoal(id);
            this.showToast('Goal deleted', 'success');
            await Goals.renderGoals();
        } catch (error) {
            this.showToast('Error deleting goal', 'error');
        }
    },

    // ============ Allocate Modal ============

    async openAllocateModal(goalId) {
        const modal = document.getElementById('allocate-modal');
        const goals = await SheetsAPI.getGoals();
        const goal = goals.find(g => g.id === goalId);
        if (!goal) return;

        document.getElementById('allocate-form').reset();
        document.getElementById('allocate-goal-id').value = goalId;
        document.getElementById('allocate-goal-name').textContent = `${goal.icon} ${goal.name}`;

        // Populate payment dropdown
        const payments = await SheetsAPI.getPayments();
        const paymentSelect = document.getElementById('allocate-payment');
        paymentSelect.innerHTML = '<option value="">-- No specific payment --</option>';
        payments.filter(p => p.status === 'in_bank' || p.status === 'paid_out').forEach(p => {
            paymentSelect.innerHTML += `<option value="${p.id}">$${parseFloat(p.amount).toFixed(2)} (${p.type}) - ${Pipeline.STAGE_LABELS[p.status]}</option>`;
        });

        modal.classList.remove('hidden');
        modal.classList.add('flex');
    },

    async handleAllocateSubmit(e) {
        e.preventDefault();
        if (this._submitting) return;

        const form = document.getElementById('allocate-form');
        const goalId = document.getElementById('allocate-goal-id').value;
        const amount = parseFloat(document.getElementById('allocate-amount').value);
        const paymentId = document.getElementById('allocate-payment').value;
        const notes = document.getElementById('allocate-notes').value.trim();

        if (!amount || amount <= 0) {
            this.showToast('Please enter a valid amount', 'error');
            return;
        }

        this.setSubmitting(form, true);
        this.closeModal('allocate-modal');

        try {
            await SheetsAPI.saveGoalAllocation({
                goalId,
                paymentId: paymentId || '',
                amount,
                date: new Date().toISOString().split('T')[0],
                notes
            });

            // Check if goal is now complete
            const goals = await SheetsAPI.getGoals();
            const allocations = await SheetsAPI.getGoalAllocations();
            const goal = goals.find(g => g.id === goalId);
            if (goal) {
                const progress = Goals.calcProgress(goal, allocations);
                if (progress.isComplete && !goal.completedAt) {
                    await SheetsAPI.updateGoal(goalId, { completedAt: new Date().toISOString() });
                }
            }

            this.showToast('$' + amount.toFixed(2) + ' allocated!', 'success');
            await Goals.renderGoals();
        } catch (error) {
            this.showToast('Error allocating funds', 'error');
        }
        this.setSubmitting(form, false);
    },

    // ============ Settings ============

    openSettingsModal() {
        const modal = document.getElementById('settings-modal');
        document.getElementById('settings-sheets-url').value = SheetsAPI.getUserAppsScriptUrl() || '';
        document.getElementById('settings-hourly-rate').value = this.getDefaultRate();
        document.getElementById('settings-tax-rate').value = Math.round(TaxCalc.getTaxRate() * 100);
        document.getElementById('settings-project-hours').value = CONFIG.PROJECT_PAYOUT_HOURS;
        document.getElementById('settings-task-hours').value = CONFIG.TASK_PAYOUT_HOURS;

        modal.classList.remove('hidden');
        modal.classList.add('flex');
    },

    saveSettings() {
        const sheetsUrl = document.getElementById('settings-sheets-url').value.trim();
        const hourlyRate = parseFloat(document.getElementById('settings-hourly-rate').value);
        const taxRate = parseFloat(document.getElementById('settings-tax-rate').value) / 100;
        const projectHours = parseInt(document.getElementById('settings-project-hours').value);
        const taskHours = parseInt(document.getElementById('settings-task-hours').value);

        if (sheetsUrl) SheetsAPI.setUserAppsScriptUrl(sheetsUrl);
        if (hourlyRate > 0) localStorage.setItem('hwt_hourly_rate', hourlyRate.toString());
        if (taxRate >= 0 && taxRate <= 1) TaxCalc.setTaxRate(taxRate);
        if (projectHours > 0) CONFIG.PROJECT_PAYOUT_HOURS = projectHours;
        if (taskHours > 0) CONFIG.TASK_PAYOUT_HOURS = taskHours;

        this.showToast('Settings saved', 'success');
        this.closeModal('settings-modal');
        this.loadData();
    },

    loadSettings() {
        const rate = localStorage.getItem('hwt_hourly_rate');
        if (rate) CONFIG.DEFAULT_HOURLY_RATE = parseFloat(rate);
    },

    getDefaultRate() {
        const saved = localStorage.getItem('hwt_hourly_rate');
        return saved ? parseFloat(saved) : CONFIG.DEFAULT_HOURLY_RATE;
    },

    // ============ Pipeline Details Toggle ============

    togglePipelineDetails() {
        const details = document.getElementById('pipeline-details');
        const btn = document.getElementById('toggle-pipeline-details');
        if (details.classList.contains('hidden')) {
            details.classList.remove('hidden');
            btn.querySelector('span').textContent = 'Hide';
            btn.querySelector('i').setAttribute('data-lucide', 'chevron-up');
        } else {
            details.classList.add('hidden');
            btn.querySelector('span').textContent = 'Details';
            btn.querySelector('i').setAttribute('data-lucide', 'chevron-down');
        }
        if (typeof lucide !== 'undefined') lucide.createIcons();
    },

    // ============ Email Scanning ============

    async scanEmails() {
        if (!SheetsAPI.isConfigured()) {
            this.showToast('Configure Google Sheets URL in Settings first', 'error');
            return;
        }

        this.showToast('Scanning emails...', 'info');
        try {
            const url = SheetsAPI.getActiveAppsScriptUrl();
            const response = await fetch(url + '?action=scanEmails');
            const data = await response.json();

            if (data.error) throw new Error(data.error);

            const results = data.results || {};
            const daCount = results.daPayouts || 0;
            const ppCount = results.paypalReceipts || 0;
            const ptCount = results.paypalTransfers || 0;
            const matched = results.matched || 0;

            this.showToast(`Found ${daCount} DA, ${ppCount} PayPal, ${ptCount} transfers, ${matched} matched`, 'success');

            // Reload data to reflect any pipeline changes
            await this.loadData();
        } catch (error) {
            console.error('Email scan error:', error);
            this.showToast('Email scan failed. Check Apps Script deployment.', 'error');
        }
    },

    // ============ Sync Indicator ============

    updateSyncIndicator(status) {
        const indicator = document.getElementById('sync-indicator');
        const text = document.getElementById('sync-status-text');
        if (!indicator || !text) return;

        const configs = {
            synced: { text: 'Synced', class: 'text-emerald-400' },
            syncing: { text: 'Syncing...', class: 'text-violet-400' },
            offline: { text: 'Offline', class: 'text-yellow-400' },
            error: { text: 'Error', class: 'text-red-400' }
        };

        const cfg = configs[status] || configs.synced;
        text.textContent = cfg.text;
        indicator.className = `flex items-center gap-1 px-2 py-1 text-xs rounded-lg transition-colors ${cfg.class}`;
    },

    // ============ Modal Utilities ============

    closeModal(modalId) {
        const modal = document.getElementById(modalId);
        if (modal) {
            modal.classList.add('hidden');
            modal.classList.remove('flex');
        }
    },

    showLoading(show) {
        const el = document.getElementById('loading');
        if (show) {
            el.classList.remove('hidden');
            el.classList.add('flex');
        } else {
            el.classList.add('hidden');
            el.classList.remove('flex');
        }
    },

    // ============ Toast ============

    showToast(message, type = 'info') {
        const container = document.getElementById('toast-container');
        if (!container) return;

        const colors = {
            success: 'bg-emerald-500/20 border-emerald-500/30 text-emerald-400',
            error: 'bg-red-500/20 border-red-500/30 text-red-400',
            info: 'bg-blue-500/20 border-blue-500/30 text-blue-400',
            warning: 'bg-yellow-500/20 border-yellow-500/30 text-yellow-400'
        };

        const icons = {
            success: 'check-circle',
            error: 'alert-circle',
            info: 'info',
            warning: 'alert-triangle'
        };

        const toast = document.createElement('div');
        toast.className = `flex items-center gap-2 px-4 py-3 rounded-xl border backdrop-blur-xl text-sm toast-enter ${colors[type] || colors.info}`;
        toast.innerHTML = `
            <i data-lucide="${icons[type] || icons.info}" class="w-4 h-4 flex-shrink-0"></i>
            <span>${message}</span>
        `;

        container.appendChild(toast);
        if (typeof lucide !== 'undefined') lucide.createIcons();

        setTimeout(() => {
            toast.classList.remove('toast-enter');
            toast.classList.add('toast-exit');
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    },

    // ============ Utilities ============

    formatDate(dateStr) {
        if (!dateStr) return '';
        const [y, m, d] = dateStr.split('-');
        return `${parseInt(m)}/${parseInt(d)}/${y}`;
    }
};

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => App.init());
