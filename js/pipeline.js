// Payment Pipeline - Email-based tracking
// Calculates pipeline stages from work sessions + email payouts

const Pipeline = {
    STAGES: ['submitted', 'pending_payout', 'paid_out', 'transferring', 'in_bank'],

    STAGE_LABELS: {
        submitted: 'Submitted',
        pending_payout: 'Available for Payout',
        paid_out: 'In PayPal',
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
        paid_out: 'wallet',
        transferring: 'arrow-right-left',
        in_bank: 'landmark'
    },

    // DA payout cooldown: 72 hours between payouts
    DA_PAYOUT_COOLDOWN_HOURS: 72,

    // Calculate payout cooldown status from most recent DA email
    getPayoutCooldown(emailPayouts) {
        const now = new Date();

        // Find most recent DA payout email
        const daPayouts = emailPayouts
            .filter(e => e.source === 'dataannotation' && e.receivedAt)
            .sort((a, b) => (b.receivedAt || '').localeCompare(a.receivedAt || ''));

        if (daPayouts.length === 0) {
            return { available: true, text: 'Available!', color: 'text-emerald-400' };
        }

        const lastPayout = new Date(daPayouts[0].receivedAt);
        const nextAvailable = new Date(lastPayout.getTime() + this.DA_PAYOUT_COOLDOWN_HOURS * 60 * 60 * 1000);
        const remainingMs = nextAvailable - now;

        if (remainingMs <= 0) {
            return { available: true, text: 'Available!', color: 'text-emerald-400' };
        }

        // Calculate days, hours, minutes
        const totalMinutes = Math.floor(remainingMs / (1000 * 60));
        const days = Math.floor(totalMinutes / (60 * 24));
        const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
        const minutes = totalMinutes % 60;

        let text = '';
        if (days > 0) {
            text = `${days}d ${hours}h ${minutes}m`;
        } else if (hours > 0) {
            text = `${hours}h ${minutes}m`;
        } else {
            text = `${minutes}m`;
        }

        // Color based on remaining time
        const remainingHours = remainingMs / (1000 * 60 * 60);
        let color;
        if (remainingHours > 48) {
            color = 'text-red-400';
        } else if (remainingHours > 24) {
            color = 'text-orange-400';
        } else {
            color = 'text-yellow-400';
        }

        return { available: false, text, color };
    },

    // Calculate pipeline totals from work sessions and email payouts
    calculateTotals(workSessions, emailPayouts) {
        const now = new Date();
        const totals = {
            submitted: 0,
            pending_payout: 0,
            paid_out: 0,
            transferring: 0,
            in_bank: 0
        };

        // Calculate Submitted and Available for Payout from work sessions
        let sessionsStillWaiting = 0;
        let sessionsPastWaiting = 0;

        workSessions.forEach(s => {
            const earnings = parseFloat(s.earnings) || 0;
            if (earnings <= 0) return;

            const submittedAt = s.submittedAt ? new Date(s.submittedAt) : null;
            if (!submittedAt) {
                // No submittedAt = treat as past waiting period
                sessionsPastWaiting += earnings;
                return;
            }

            const payoutHours = s.type === 'task' ? CONFIG.TASK_PAYOUT_HOURS : CONFIG.PROJECT_PAYOUT_HOURS;
            const payoutExpected = new Date(submittedAt.getTime() + payoutHours * 60 * 60 * 1000);

            if (now < payoutExpected) {
                sessionsStillWaiting += earnings;
            } else {
                sessionsPastWaiting += earnings;
            }
        });

        totals.submitted = sessionsStillWaiting;

        // Calculate email-based totals
        let daTotal = 0;
        let transfersCompleted = 0;
        let transfersInProgress = 0;

        emailPayouts.forEach(e => {
            const amount = parseFloat(e.amount) || 0;
            if (amount <= 0) return;

            if (e.source === 'dataannotation') {
                daTotal += amount;
            } else if (e.source === 'paypal_transfer') {
                const estimatedArrival = e.estimatedArrival ? new Date(e.estimatedArrival) : null;
                if (estimatedArrival && now >= estimatedArrival) {
                    transfersCompleted += amount;
                } else {
                    transfersInProgress += amount;
                }
            }
        });

        // Available for Payout = sessions past waiting - DA payouts received (min 0)
        totals.pending_payout = Math.max(0, sessionsPastWaiting - daTotal);

        // In PayPal = DA payouts - transfers (min 0)
        totals.paid_out = Math.max(0, daTotal - transfersCompleted - transfersInProgress);

        // Transferring = transfers in progress
        totals.transferring = transfersInProgress;

        // In Bank = completed transfers
        totals.in_bank = transfersCompleted;

        return totals;
    },

    // Render pipeline visualization
    renderPipeline(workSessions, emailPayouts) {
        const totals = this.calculateTotals(workSessions, emailPayouts);
        const cooldown = this.getPayoutCooldown(emailPayouts);
        const container = document.getElementById('pipeline-stages');
        if (!container) return;

        // Stage bar
        let html = '<div class="flex items-center gap-0 mb-6">';
        this.STAGES.forEach((stage, i) => {
            const total = totals[stage];
            const colors = this.STAGE_COLORS[stage];
            const isActive = total > 0;

            if (i > 0) {
                html += `<div class="pipeline-connector flex-1 ${isActive ? 'bg-white/20' : 'bg-white/5'}"></div>`;
            }

            // Special handling for Available for Payout stage - show cooldown timer
            let extraInfo = '';
            if (stage === 'pending_payout') {
                extraInfo = `<div class="text-xs ${cooldown.color} mt-1 font-medium">${cooldown.text}</div>`;
            }

            html += `
                <div class="flex flex-col items-center min-w-[80px]">
                    <div class="pipeline-dot ${isActive ? 'active' : ''}" style="background-color: ${isActive ? colors.dot : 'rgba(255,255,255,0.1)'}; color: ${colors.dot};"></div>
                    <div class="text-xs ${isActive ? colors.text : 'text-slate-600'} mt-2 font-medium text-center">${this.STAGE_LABELS[stage]}</div>
                    <div class="text-sm font-bold ${isActive ? 'text-white' : 'text-slate-700'} mt-1">${formatCurrency(total)}</div>
                    ${extraInfo}
                </div>
            `;
        });
        html += '</div>';

        container.innerHTML = html;

        // Details section
        this.renderDetails(totals, emailPayouts);
    },

    renderDetails(totals, emailPayouts) {
        const container = document.getElementById('pipeline-details');
        if (!container) return;

        const now = new Date();
        let html = '';

        // Show recent email payouts as detail items
        const recentEmails = emailPayouts
            .filter(e => e.source === 'dataannotation' || e.source === 'paypal_transfer')
            .sort((a, b) => (b.receivedAt || '').localeCompare(a.receivedAt || ''))
            .slice(0, 10);

        if (recentEmails.length > 0) {
            html += '<div class="mb-4"><h4 class="text-sm font-medium text-slate-400 mb-2">Recent Activity</h4><div class="space-y-2">';

            recentEmails.forEach(e => {
                const amount = parseFloat(e.amount) || 0;
                let stage, label;

                if (e.source === 'dataannotation') {
                    stage = 'paid_out';
                    label = 'DA Payout';
                } else if (e.source === 'paypal_transfer') {
                    const estimatedArrival = e.estimatedArrival ? new Date(e.estimatedArrival) : null;
                    if (estimatedArrival && now >= estimatedArrival) {
                        stage = 'in_bank';
                        label = 'Bank Transfer';
                    } else {
                        stage = 'transferring';
                        label = 'Transferring';
                    }
                }

                const colors = this.STAGE_COLORS[stage];
                const date = e.receivedAt ? new Date(e.receivedAt).toLocaleDateString() : '';

                html += `
                    <div class="flex items-center justify-between p-3 rounded-lg ${colors.bg} border ${colors.border}">
                        <div class="flex items-center gap-3">
                            <i data-lucide="${this.STAGE_ICONS[stage]}" class="w-4 h-4 ${colors.text}"></i>
                            <div>
                                <span class="text-sm font-medium text-white">${formatCurrency(amount)}</span>
                                <span class="text-xs text-slate-400 ml-2">${label}</span>
                            </div>
                        </div>
                        <span class="text-xs text-slate-500">${date}</span>
                    </div>
                `;
            });

            html += '</div></div>';
        }

        const totalPipeline = Object.values(totals).reduce((a, b) => a + b, 0);
        if (totalPipeline === 0 && recentEmails.length === 0) {
            html = '<p class="text-sm text-slate-500 text-center py-4">No activity in pipeline yet. Log work sessions and scan emails to track payments.</p>';
        }

        container.innerHTML = html;
        if (typeof lucide !== 'undefined') lucide.createIcons();
    }
};
