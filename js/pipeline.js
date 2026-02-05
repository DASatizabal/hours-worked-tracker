// Payment Pipeline State Machine
// Manages payment lifecycle: submitted -> pending_payout -> paid_out -> transferring -> in_bank

const Pipeline = {
    STAGES: ['submitted', 'pending_payout', 'paid_out', 'transferring', 'in_bank'],

    STAGE_LABELS: {
        submitted: 'Submitted',
        pending_payout: 'Pending Payout',
        paid_out: 'Paid Out',
        transferring: 'Transferring',
        in_bank: 'In Bank'
    },

    STAGE_COLORS: {
        submitted: { dot: '#eab308', text: 'text-yellow-400', bg: 'bg-yellow-500/10', border: 'border-yellow-500/30' },
        pending_payout: { dot: '#f97316', text: 'text-orange-400', bg: 'bg-orange-500/10', border: 'border-orange-500/30' },
        paid_out: { dot: '#3b82f6', text: 'text-blue-400', bg: 'bg-blue-500/10', border: 'border-blue-500/30' },
        transferring: { dot: '#06b6d4', text: 'text-cyan-400', bg: 'bg-cyan-500/10', border: 'border-cyan-500/30' },
        in_bank: { dot: '#22c55e', text: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/30' }
    },

    STAGE_ICONS: {
        submitted: 'send',
        pending_payout: 'clock',
        paid_out: 'check-circle',
        transferring: 'arrow-right-left',
        in_bank: 'landmark'
    },

    // Create a new payment from work sessions
    createPayment(workSessionIds, amount, type, submittedAt) {
        const subAt = submittedAt || new Date().toISOString();
        const payoutHours = type === 'project' ? CONFIG.PROJECT_PAYOUT_HOURS : CONFIG.TASK_PAYOUT_HOURS;
        const payoutExpected = new Date(new Date(subAt).getTime() + payoutHours * 60 * 60 * 1000).toISOString();

        return {
            workSessionIds: workSessionIds.join(','),
            amount: amount,
            tax: TaxCalc.calcTax(amount),
            netAmount: TaxCalc.calcNet(amount),
            type: type,
            status: 'submitted',
            submittedAt: subAt,
            payoutExpectedAt: payoutExpected,
            paidOutAt: '',
            daPaymentId: '',
            transferExpectedAt: '',
            transferredAt: '',
            paypalTransactionId: '',
            inBankAt: '',
            notes: ''
        };
    },

    // Auto-advance payments based on timers
    autoAdvance(payments) {
        const now = new Date();
        let changed = false;

        payments.forEach(p => {
            if (p.status === 'submitted' && p.payoutExpectedAt) {
                if (now >= new Date(p.payoutExpectedAt)) {
                    p.status = 'pending_payout';
                    changed = true;
                }
            }
        });

        return changed;
    },

    // Advance a payment to the next status
    advancePayment(payment, newStatus, extraData) {
        payment.status = newStatus;

        if (newStatus === 'paid_out') {
            payment.paidOutAt = extraData?.paidOutAt || new Date().toISOString();
            payment.daPaymentId = extraData?.daPaymentId || '';
            payment.transferExpectedAt = this.calcTransferExpected(payment.paidOutAt);
        } else if (newStatus === 'transferring') {
            if (!payment.transferExpectedAt && payment.paidOutAt) {
                payment.transferExpectedAt = this.calcTransferExpected(payment.paidOutAt);
            }
        } else if (newStatus === 'in_bank') {
            payment.inBankAt = extraData?.inBankAt || new Date().toISOString();
            payment.paypalTransactionId = extraData?.paypalTransactionId || '';
            if (!payment.transferredAt) {
                payment.transferredAt = payment.inBankAt;
            }
        }

        return payment;
    },

    // Calculate transfer expected date (paidOutAt + 3 business days)
    calcTransferExpected(paidOutAt) {
        const date = new Date(paidOutAt);
        let businessDays = 0;
        while (businessDays < CONFIG.PAYPAL_TRANSFER_BUSINESS_DAYS) {
            date.setDate(date.getDate() + 1);
            const day = date.getDay();
            if (day !== 0 && day !== 6) businessDays++;
        }
        return date.toISOString();
    },

    // Get countdown string for a target date
    getCountdown(targetDate) {
        if (!targetDate) return '';
        const now = new Date();
        const target = new Date(targetDate);
        const diff = target - now;

        if (diff <= 0) return 'Due now';

        const hours = Math.floor(diff / (1000 * 60 * 60));
        const days = Math.floor(hours / 24);
        const remainingHours = hours % 24;

        if (days > 0) return `${days}d ${remainingHours}h`;
        return `${hours}h`;
    },

    // Get payments grouped by stage
    groupByStage(payments) {
        const groups = {};
        this.STAGES.forEach(s => { groups[s] = []; });
        payments.forEach(p => {
            if (groups[p.status]) groups[p.status].push(p);
        });
        return groups;
    },

    // Render pipeline visualization
    renderPipeline(payments) {
        const groups = this.groupByStage(payments);
        const container = document.getElementById('pipeline-stages');
        if (!container) return;

        // Stage bar
        let html = '<div class="flex items-center gap-0 mb-6">';
        this.STAGES.forEach((stage, i) => {
            const count = groups[stage].length;
            const total = groups[stage].reduce((s, p) => s + (parseFloat(p.amount) || 0), 0);
            const colors = this.STAGE_COLORS[stage];
            const isActive = count > 0;

            if (i > 0) {
                html += `<div class="pipeline-connector flex-1 ${isActive ? 'bg-white/20' : 'bg-white/5'}"></div>`;
            }

            html += `
                <div class="flex flex-col items-center min-w-[80px]">
                    <div class="pipeline-dot ${isActive ? 'active' : ''}" style="background-color: ${isActive ? colors.dot : 'rgba(255,255,255,0.1)'}; color: ${colors.dot};"></div>
                    <div class="text-xs ${isActive ? colors.text : 'text-slate-600'} mt-2 font-medium text-center">${this.STAGE_LABELS[stage]}</div>
                    <div class="text-sm font-bold ${isActive ? 'text-white' : 'text-slate-700'} mt-1">$${total.toFixed(0)}</div>
                    <div class="text-xs ${isActive ? 'text-slate-400' : 'text-slate-700'}">${count} item${count !== 1 ? 's' : ''}</div>
                </div>
            `;
        });
        html += '</div>';

        container.innerHTML = html;

        // Details section
        this.renderDetails(groups);
    },

    renderDetails(groups) {
        const container = document.getElementById('pipeline-details');
        if (!container) return;

        let html = '';

        this.STAGES.forEach(stage => {
            const payments = groups[stage];
            if (payments.length === 0) return;

            const colors = this.STAGE_COLORS[stage];
            html += `<div class="mb-4">
                <h4 class="text-sm font-medium ${colors.text} mb-2">${this.STAGE_LABELS[stage]} (${payments.length})</h4>
                <div class="space-y-2">`;

            payments.forEach(p => {
                let countdown = '';
                if (stage === 'submitted') {
                    countdown = this.getCountdown(p.payoutExpectedAt);
                } else if (stage === 'paid_out' || stage === 'transferring') {
                    countdown = this.getCountdown(p.transferExpectedAt);
                }

                const countdownHTML = countdown ? `<span class="text-xs text-slate-500 ml-2">${countdown}</span>` : '';

                html += `
                    <div class="flex items-center justify-between p-3 rounded-lg ${colors.bg} border ${colors.border}">
                        <div class="flex items-center gap-3">
                            <i data-lucide="${this.STAGE_ICONS[stage]}" class="w-4 h-4 ${colors.text}"></i>
                            <div>
                                <span class="text-sm font-medium text-white">$${(parseFloat(p.amount) || 0).toFixed(2)}</span>
                                <span class="text-xs text-slate-400 ml-2 capitalize">${p.type}</span>
                                ${countdownHTML}
                            </div>
                        </div>
                        <div class="flex items-center gap-2">
                            ${stage !== 'in_bank' ? `
                                <button class="text-xs px-2 py-1 ${colors.bg} ${colors.text} border ${colors.border} rounded-lg hover:opacity-80 transition-opacity" onclick="App.advancePayment('${p.id}')">
                                    Advance
                                </button>
                            ` : ''}
                            <button class="text-xs px-2 py-1 bg-white/5 text-slate-400 rounded-lg hover:text-white transition-colors" onclick="App.editPayment('${p.id}')">
                                Edit
                            </button>
                        </div>
                    </div>
                `;
            });

            html += '</div></div>';
        });

        if (html === '') {
            html = '<p class="text-sm text-slate-500 text-center py-4">No payments in pipeline yet. Create a payment from your work sessions.</p>';
        }

        container.innerHTML = html;
        if (typeof lucide !== 'undefined') lucide.createIcons();
    }
};
