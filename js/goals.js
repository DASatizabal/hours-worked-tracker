// Savings Goal Management + Progress Calculations

const Goals = {
    // Cruise goal config (syncs with cruise-payment-tracker app)
    CRUISE_GOAL_NAME: 'November Cruise',
    CRUISE_TARGET: 2355.44,

    // Get current default hourly rate
    getHourlyRate() {
        const saved = localStorage.getItem('hwt_hourly_rate');
        return saved ? parseFloat(saved) : CONFIG.DEFAULT_HOURLY_RATE;
    },

    // Get David's total paid from cruise-payment-tracker localStorage
    getCruisePaymentTotal() {
        try {
            const data = localStorage.getItem('cruise-payments');
            if (!data) return 0;
            const payments = JSON.parse(data);
            // Sum all payments where person === 'david'
            return payments
                .filter(p => p.person === 'david')
                .reduce((sum, p) => sum + (parseFloat(p.amount) || 0), 0);
        } catch (e) {
            console.error('Error reading cruise payments:', e);
            return 0;
        }
    },

    // Calculate goal progress
    calcProgress(goal, allocations) {
        // Special handling for cruise goal - sync from cruise-payment-tracker
        const isCruiseGoal = goal.name === this.CRUISE_GOAL_NAME;

        let savedAmount;
        if (isCruiseGoal) {
            savedAmount = this.getCruisePaymentTotal();
        } else {
            const goalAllocs = allocations.filter(a => a.goalId === goal.id);
            savedAmount = goalAllocs.reduce((sum, a) => sum + (parseFloat(a.amount) || 0), 0);
        }

        const targetAmount = parseFloat(goal.targetAmount) || 0;
        const remaining = Math.max(0, targetAmount - savedAmount);
        const percentage = targetAmount > 0 ? Math.min(100, Math.round((savedAmount / targetAmount) * 100)) : 0;
        const hourlyRate = this.getHourlyRate();
        const hoursRemaining = hourlyRate > 0 ? remaining / hourlyRate : 0;
        const totalHoursNeeded = hourlyRate > 0 ? targetAmount / hourlyRate : 0;

        return {
            savedAmount,
            targetAmount,
            remaining,
            percentage,
            hoursRemaining,
            totalHoursNeeded,
            isComplete: savedAmount >= targetAmount
        };
    },

    // Render all goal cards
    async renderGoals() {
        const container = document.getElementById('goals-container');
        if (!container) return;

        const goals = await SheetsAPI.getGoals();
        const allocations = await SheetsAPI.getGoalAllocations();

        if (goals.length === 0) {
            container.innerHTML = `
                <div class="col-span-full text-center py-8 text-slate-500 text-sm">
                    No savings goals yet. Click "New Goal" to create one.
                </div>
            `;
            return;
        }

        let html = '';
        goals.forEach(goal => {
            const progress = this.calcProgress(goal, allocations);
            html += this.renderGoalCard(goal, progress);
        });

        container.innerHTML = html;
        if (typeof lucide !== 'undefined') lucide.createIcons();
    },

    renderGoalCard(goal, progress) {
        const isCruiseGoal = goal.name === this.CRUISE_GOAL_NAME;
        const statusColor = progress.isComplete ? 'border-emerald-500/50' : 'border-white/10 hover:border-violet-500/50';

        let badges = '';
        if (progress.isComplete) {
            badges += '<span class="px-2 py-0.5 text-xs bg-emerald-500/20 text-emerald-400 rounded-full">Complete!</span>';
        }
        if (isCruiseGoal) {
            badges += '<span class="px-2 py-0.5 text-xs bg-cyan-500/20 text-cyan-400 rounded-full ml-1">Auto-synced</span>';
        }

        const hoursHTML = !progress.isComplete
            ? `<div class="text-xs text-slate-500 mt-1">${progress.hoursRemaining.toFixed(1)} hours of work remaining</div>`
            : '';

        // Cruise goal doesn't need allocate button (synced from cruise tracker)
        const allocateBtn = !progress.isComplete && !isCruiseGoal
            ? `<button class="w-full mt-4 py-2.5 bg-gradient-to-r from-emerald-600 to-cyan-600 hover:from-emerald-500 hover:to-cyan-500 text-white font-medium rounded-xl transition-all duration-300" onclick="App.openAllocateModal('${goal.id}')">Allocate Funds</button>`
            : '';

        return `
            <div class="goal-card group relative bg-white/5 backdrop-blur-xl rounded-2xl p-6 border ${statusColor} transition-all duration-300 hover:shadow-lg card">
                <div class="absolute inset-0 bg-gradient-to-br from-violet-600/5 to-transparent rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity"></div>
                <div class="relative">
                    <div class="flex items-center justify-between mb-4">
                        <div class="flex items-center gap-3">
                            <span class="text-2xl">${goal.icon || '🎯'}</span>
                            <div>
                                <h3 class="font-semibold text-white">${goal.name}</h3>
                                <div class="text-sm text-slate-400">$${progress.targetAmount.toFixed(2)} goal</div>
                            </div>
                        </div>
                        <div class="flex items-center gap-2">
                            ${badges}
                            <button class="p-1 hover:bg-white/10 rounded-lg transition-colors" onclick="App.editGoal('${goal.id}')" title="Edit goal">
                                <i data-lucide="pencil" class="w-3.5 h-3.5 text-slate-500"></i>
                            </button>
                            <button class="p-1 hover:bg-white/10 rounded-lg transition-colors" onclick="App.deleteGoal('${goal.id}')" title="Delete goal">
                                <i data-lucide="trash-2" class="w-3.5 h-3.5 text-slate-500 hover:text-red-400"></i>
                            </button>
                        </div>
                    </div>

                    <div class="mt-4">
                        <div class="flex justify-between text-sm text-slate-400 mb-2">
                            <span>$${progress.savedAmount.toFixed(2)} of $${progress.targetAmount.toFixed(2)} saved</span>
                            <span>${progress.percentage}%</span>
                        </div>
                        <div class="h-2 bg-white/10 rounded-full overflow-hidden progress-bar-bg">
                            <div class="h-full progress-gradient rounded-full transition-all duration-500" style="width: ${progress.percentage}%"></div>
                        </div>
                        ${!progress.isComplete ? `
                            <div class="text-sm font-medium text-cyan-400 mt-2">$${progress.remaining.toFixed(2)} remaining</div>
                        ` : ''}
                        ${hoursHTML}
                    </div>

                    ${allocateBtn}
                </div>
            </div>
        `;
    }
};
