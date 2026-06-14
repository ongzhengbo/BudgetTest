class BudgetModule {
    constructor(spreadsheetId) {
        this.spreadsheetId = spreadsheetId;
        this.state = null;
        this.activeTransactionFilter = 'all';
        this.activeSearch = '';
    }

    async loadConfig() {
        await SheetsAPI.ensureBudgetSchema(this.spreadsheetId);
    }

    async renderModules() {
        const container = document.getElementById('budget-dashboard');
        if (!container) return;

        try {
            this.state = await this.loadState();
            container.innerHTML = this.renderSmartBudget();
        } catch (err) {
            console.error('Failed to render SheZ Budgetting:', err);
            container.innerHTML = `
                <div class="error-card">
                    <h2>Could not load this budget.</h2>
                    <p>Check that your Google account has access to this sheet.</p>
                    <button class="btn-secondary" onclick="app.showDashboard()">Back to Dashboard</button>
                </div>
            `;
        }
    }

    async loadState() {
        const [incomeRows, expenseRows, groupRows, ledgerRows, categoryRows] = await Promise.all([
            SheetsAPI.getValues(this.spreadsheetId, 'Income!A1:E'),
            SheetsAPI.getValues(this.spreadsheetId, 'Expenses!A1:F'),
            SheetsAPI.getValues(this.spreadsheetId, 'AllocationGroups!A1:E'),
            SheetsAPI.getValues(this.spreadsheetId, 'AllocationLedger!A1:G'),
            SheetsAPI.getValues(this.spreadsheetId, 'Categories!A1:C')
        ]);

        const groups = this.parseGroups(groupRows);
        const income = this.parseIncome(incomeRows);
        const expenses = this.parseExpenses(expenseRows);
        const ledger = this.parseLedger(ledgerRows);
        const categories = this.parseCategories(categoryRows);

        const allocatedByBucket = new Map();
        ledger.forEach(entry => {
            allocatedByBucket.set(entry.group, (allocatedByBucket.get(entry.group) || 0) + entry.amount);
        });

        const spentByBucket = new Map();
        expenses.forEach(expense => {
            spentByBucket.set(expense.bucket, (spentByBucket.get(expense.bucket) || 0) + expense.amount);
        });

        const buckets = groups.map(group => {
            const allocated = allocatedByBucket.get(group.name) || 0;
            const spent = spentByBucket.get(group.name) || 0;
            return {
                ...group,
                allocated,
                spent,
                balance: allocated - spent
            };
        });

        const totalIncome = income.reduce((sum, row) => sum + row.amount, 0);
        const totalSpent = expenses.reduce((sum, row) => sum + row.amount, 0);
        const netWorth = buckets.reduce((sum, bucket) => sum + bucket.balance, 0);
        const availableToSpend = buckets.find(bucket => bucket.name.toLowerCase() === 'spending')?.balance || 0;
        const totalPercent = buckets.filter(b => b.active).reduce((sum, bucket) => sum + bucket.percent, 0);

        const transactions = [
            ...income.map(item => ({
                date: item.date,
                description: item.description,
                bucket: 'Income',
                amount: item.amount,
                type: 'income'
            })),
            ...expenses.map(item => ({
                date: item.date,
                description: item.description,
                bucket: item.bucket,
                amount: -item.amount,
                type: 'expense'
            }))
        ].sort((a, b) => new Date(b.date) - new Date(a.date));

        return {
            groups,
            buckets,
            income,
            expenses,
            ledger,
            categories,
            totalIncome,
            totalSpent,
            netWorth,
            availableToSpend,
            totalPercent,
            transactions
        };
    }

    renderSmartBudget() {
        const state = this.state;
        const user = AuthManager.getCurrentUser();
        const userName = user?.name || 'Account';
        const splitText = state.buckets
            .filter(bucket => bucket.active)
            .map(bucket => `${this.formatPercent(bucket.percent)} ${bucket.name}`)
            .join(', ');

        return `
            <div class="smartbudget-layout">
                <section class="smart-topbar">
                    <div class="brand compact-brand">
                        <div class="brand-icon">▣</div>
                        <div>
                            <h1>${CONFIG.APP_DISPLAY_NAME}</h1>
                            <p>${this.formatLongDate(new Date())}</p>
                        </div>
                    </div>

                    <div class="smart-actions">
                        <button class="btn-primary" onclick="budgetModule.openAllocationRules()">Allocation Rules</button>
                        <button class="btn-secondary" onclick="budgetModule.openShareModal()">Share</button>
                        <button class="btn-secondary" onclick="budgetModule.exportTransactions()">Export</button>
                        <button class="btn-danger subtle" onclick="budgetModule.resetBudget()">Reset</button>
                        <button class="btn-secondary" onclick="app.showDashboard()">Dashboard</button>
                    </div>

                    <div class="topbar-account">
                        <span>${this.escapeHtml(userName)}</span>
                        <button class="btn-secondary" onclick="app.logout()">Log out</button>
                    </div>
                </section>

                <section class="bucket-section">
                    <div class="section-row">
                        <h2>Money Buckets</h2>
                        <p>Auto-split: ${this.escapeHtml(splitText || 'No active rules')}</p>
                    </div>
                    <div class="bucket-grid">
                        ${state.buckets.map((bucket, index) => this.renderBucketCard(bucket, index)).join('')}
                    </div>
                </section>

                <section class="summary-grid">
                    ${this.renderMetricCard('Total Income', state.totalIncome, 'income', '↓')}
                    ${this.renderMetricCard('Total Spent', state.totalSpent, 'expense', '↑')}
                    ${this.renderMetricCard('Available to Spend', state.availableToSpend, 'available', '♨')}
                    ${this.renderMetricCard('Net Worth', state.netWorth, 'networth', '◆')}
                </section>

                <section class="content-grid">
                    <div class="left-column">
                        ${this.renderIncomeForm()}
                        ${this.renderExpenseForm()}
                    </div>

                    <div class="right-column">
                        ${this.renderAnalytics()}
                        ${this.renderTransactions()}
                    </div>
                </section>

                ${this.renderAllocationRulesModal()}
                ${this.renderShareModal()}
            </div>
        `;
    }

    renderBucketCard(bucket, index) {
        const icons = ['▰', '✚', '↘', '⬟', '◇', '●'];
        const icon = icons[index % icons.length];
        const width = Math.max(0, Math.min(100, bucket.percent));

        return `
            <article class="bucket-card bucket-${index % 4}">
                <div class="bucket-title-row">
                    <span class="bucket-icon">${icon}</span>
                    <div>
                        <strong>${this.escapeHtml(bucket.name)}</strong>
                        <small>${this.formatPercent(bucket.percent)} of income</small>
                    </div>
                </div>
                <div class="bucket-amount">${this.formatMoney(bucket.balance)}</div>
                <div class="bucket-progress"><span style="width: ${width}%"></span></div>
            </article>
        `;
    }

    renderMetricCard(label, amount, type, icon) {
        return `
            <article class="metric-card ${type}">
                <div>
                    <p>${this.escapeHtml(label)}</p>
                    <strong>${this.formatMoney(amount)}</strong>
                </div>
                <span>${icon}</span>
            </article>
        `;
    }

    renderIncomeForm() {
        const today = this.toInputDate(new Date());

        return `
            <form class="action-card" onsubmit="budgetModule.addIncome(event)">
                <h3><span class="dot positive"></span>Add Income</h3>
                <p>Money will be automatically split into your buckets based on allocation rules.</p>

                <label>Description
                    <input id="income-description" type="text" placeholder="e.g., Monthly Salary" required>
                </label>

                <label>Amount
                    <input id="income-amount" type="number" min="0" step="0.01" placeholder="$ 0.00" required>
                </label>

                <label>Date
                    <input id="income-date" type="date" value="${today}" required>
                </label>

                <button class="btn-income" type="submit">✓ Add Income & Split</button>
                <p id="income-status" class="form-status"></p>
            </form>
        `;
    }

    renderExpenseForm() {
        const today = this.toInputDate(new Date());
        const bucketOptions = this.state.buckets
            .map(bucket => `<option value="${this.escapeHtml(bucket.name)}">${this.escapeHtml(bucket.name)} (${this.formatMoney(bucket.balance)})</option>`)
            .join('');

        const categoryOptions = this.state.categories
            .map(category => `<option value="${this.escapeHtml(category)}">${this.escapeHtml(category)}</option>`)
            .join('');

        return `
            <form class="action-card spend-card" onsubmit="budgetModule.addExpense(event)">
                <h3><span class="dot negative"></span>Spend Money</h3>
                <p>Deduct from your Spending bucket or any other bucket.</p>

                <label>Description
                    <input id="expense-description" type="text" placeholder="e.g., Grocery shopping" required>
                </label>

                <label>Amount
                    <input id="expense-amount" type="number" min="0" step="0.01" placeholder="$ 0.00" required>
                </label>

                <label>Pay From Bucket
                    <select id="expense-bucket" required>${bucketOptions}</select>
                </label>

                <label>Category
                    <select id="expense-category" required>${categoryOptions}</select>
                </label>

                <label>Date
                    <input id="expense-date" type="date" value="${today}" required>
                </label>

                <button class="btn-expense" type="submit">✓ Spend Money</button>
                <p id="expense-status" class="form-status"></p>
            </form>
        `;
    }

    renderAnalytics() {
        const maxBalance = Math.max(...this.state.buckets.map(bucket => Math.abs(bucket.balance)), 1);

        return `
            <article class="panel analytics-panel">
                <div class="panel-header">
                    <h3>Analytics</h3>
                    <div class="time-tabs">
                        <button class="active">Week</button>
                        <button>Month</button>
                        <button>Year</button>
                    </div>
                </div>
                <div class="analytics-bars">
                    ${this.state.buckets.map(bucket => {
                        const width = Math.max(4, Math.min(100, Math.abs(bucket.balance) / maxBalance * 100));
                        return `
                            <div class="analytics-row">
                                <span>${this.escapeHtml(bucket.name)}</span>
                                <div class="analytics-track"><span style="width:${width}%"></span></div>
                                <strong>${this.formatMoney(bucket.balance)}</strong>
                            </div>
                        `;
                    }).join('')}
                </div>
            </article>
        `;
    }

    renderTransactions() {
        const query = this.activeSearch.trim().toLowerCase();
        const type = this.activeTransactionFilter;

        const transactions = this.state.transactions.filter(item => {
            const matchesType = type === 'all' || item.type === type;
            const matchesQuery = !query || [item.date, item.description, item.bucket, item.type]
                .join(' ')
                .toLowerCase()
                .includes(query);
            return matchesType && matchesQuery;
        });

        const rows = transactions.slice(0, 12).map(item => `
            <tr>
                <td>${this.escapeHtml(item.date)}</td>
                <td>${this.escapeHtml(item.description)}</td>
                <td>${this.escapeHtml(item.bucket)}</td>
                <td class="amount-cell ${item.type}">${item.amount >= 0 ? '+' : '-'}${this.formatMoney(Math.abs(item.amount))}</td>
                <td><span class="type-pill ${item.type}">${this.escapeHtml(item.type)}</span></td>
            </tr>
        `).join('');

        return `
            <article class="panel transaction-panel">
                <div class="panel-header transaction-header">
                    <h3>Recent Transactions</h3>
                    <div class="transaction-tools">
                        <input
                            id="transaction-search"
                            type="search"
                            placeholder="Search..."
                            value="${this.escapeHtml(this.activeSearch)}"
                            oninput="budgetModule.setTransactionSearch(this.value)"
                        >
                        <select id="transaction-type" onchange="budgetModule.setTransactionFilter(this.value)">
                            <option value="all" ${type === 'all' ? 'selected' : ''}>All Types</option>
                            <option value="income" ${type === 'income' ? 'selected' : ''}>Income</option>
                            <option value="expense" ${type === 'expense' ? 'selected' : ''}>Expense</option>
                        </select>
                    </div>
                </div>

                <div class="table-wrap transactions-wrap">
                    <table class="transaction-table">
                        <thead>
                            <tr>
                                <th>Date</th>
                                <th>Description</th>
                                <th>Bucket</th>
                                <th>Amount</th>
                                <th>Type</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${rows || `<tr><td colspan="5" class="empty-table">▦<br>No transactions yet. Add your first income!</td></tr>`}
                        </tbody>
                    </table>
                </div>

                <div class="table-footer">
                    <span>${transactions.length} transactions</span>
                    <span>Page 1 of 1</span>
                </div>
            </article>
        `;
    }

    renderAllocationRulesModal() {
        const rows = this.state.buckets.map(bucket => this.renderRuleRow(bucket)).join('');

        return `
            <div id="allocation-modal" class="modal hidden">
                <div class="modal-card rules-modal-card">
                    <div class="modal-header">
                        <div>
                            <h3>Allocation Rules</h3>
                            <p>Active bucket percentages should add up to 100%. Delete removes the bucket rule, while old transactions remain in the sheet history.</p>
                        </div>
                        <button class="icon-button" type="button" onclick="budgetModule.closeAllocationRules()">×</button>
                    </div>

                    <div class="rules-list">
                        <div class="rule-head">
                            <span>Bucket</span>
                            <span>Percent</span>
                            <span>Status</span>
                            <span>Action</span>
                        </div>
                        ${rows}
                    </div>

                    <div class="rules-total">
                        <span>Active total</span>
                        <strong id="rules-total-value">${this.formatPercent(this.state.totalPercent)}</strong>
                    </div>

                    <div class="modal-actions">
                        <button class="btn-secondary" type="button" onclick="budgetModule.addRuleRow()">+ Add Bucket</button>
                        <button class="btn-primary" type="button" onclick="budgetModule.saveAllocationRules()">Save Rules</button>
                    </div>
                    <p id="rules-status" class="form-status"></p>
                </div>
            </div>
        `;
    }

    renderRuleRow(bucket = { name: '', percent: 0, active: true }) {
        return `
            <div class="rule-row" data-original-name="${this.escapeHtml(bucket.name)}">
                <input class="rule-name" type="text" value="${this.escapeHtml(bucket.name)}" placeholder="Bucket name" oninput="budgetModule.updateRulesPreview()">
                <input class="rule-percent" type="number" min="0" max="100" step="0.01" value="${this.parseNumber(bucket.percent)}" oninput="budgetModule.updateRulesPreview()">
                <select class="rule-active" onchange="budgetModule.updateRulesPreview()">
                    <option value="TRUE" ${bucket.active ? 'selected' : ''}>Active</option>
                    <option value="FALSE" ${!bucket.active ? 'selected' : ''}>Off</option>
                </select>
                <button class="rule-delete-button" type="button" onclick="budgetModule.deleteRuleRow(this)">Delete</button>
            </div>
        `;
    }


    renderShareModal() {
        const shareUrl = `${location.origin}${location.pathname}#budget=${encodeURIComponent(this.spreadsheetId)}`;

        return `
            <div id="share-modal" class="modal hidden">
                <div class="modal-card share-modal-card">
                    <div class="modal-header">
                        <div>
                            <h3>Share ${CONFIG.APP_DISPLAY_NAME}</h3>
                            <p>Give friends access to this Google Sheet budget, then send them the app link.</p>
                        </div>
                        <button class="icon-button" onclick="budgetModule.closeShareModal()">×</button>
                    </div>

                    <form class="share-form" onsubmit="budgetModule.shareBudget(event)">
                        <label>Email addresses
                            <textarea id="share-emails" placeholder="friend@example.com, anotherfriend@example.com" required></textarea>
                        </label>

                        <label>Permission
                            <select id="share-role">
                                <option value="writer" selected>Can edit budget</option>
                                <option value="reader">Can view only</option>
                            </select>
                        </label>

                        <button class="btn-primary" type="submit">Share with Friends</button>
                        <p id="share-status" class="form-status"></p>
                    </form>

                    <div class="copy-link-row">
                        <input id="share-link" type="text" value="${this.escapeHtml(shareUrl)}" readonly>
                        <button class="btn-secondary" onclick="budgetModule.copyShareLink()">Copy Link</button>
                    </div>

                    <div class="permissions-panel">
                        <div class="permissions-header">
                            <h4>Current Access</h4>
                            <button class="btn-secondary compact-button" onclick="budgetModule.loadSharePermissions()">Refresh</button>
                        </div>
                        <div id="share-permissions-list" class="permissions-list">
                            <p class="muted-text">Open this panel to load current access.</p>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    async addIncome(event) {
        event.preventDefault();

        const description = document.getElementById('income-description').value.trim();
        const amount = this.parseNumber(document.getElementById('income-amount').value);
        const date = document.getElementById('income-date').value;

        if (!description || amount <= 0 || !date) {
            this.setStatus('income-status', 'Please enter a valid income description, amount, and date.', 'bad');
            return;
        }

        const groups = this.state.buckets.filter(bucket => bucket.active && bucket.percent > 0);
        if (!groups.length) {
            this.setStatus('income-status', 'Add at least one active allocation rule first.', 'bad');
            return;
        }

        const totalPercent = groups.reduce((sum, bucket) => sum + bucket.percent, 0);
        if (Math.abs(totalPercent - 100) > 0.001) {
            const proceed = confirm(`Your active allocation rules add up to ${this.formatPercent(totalPercent)}, not 100%. Continue anyway?`);
            if (!proceed) return;
        }

        const button = event.submitter;
        this.setBusy(button, true, 'Saving...');

        try {
            const user = AuthManager.getCurrentUser();
            await SheetsAPI.appendValues(this.spreadsheetId, 'Income!A1:E1', [
                date,
                description,
                amount,
                'Income',
                'Auto-split into money buckets'
            ]);

            const ledgerRows = groups.map(bucket => [
                date,
                amount,
                bucket.name,
                bucket.percent,
                +(amount * (bucket.percent / 100)).toFixed(2),
                description,
                user?.email || ''
            ]);

            await SheetsAPI.appendRows(this.spreadsheetId, 'AllocationLedger!A1:G1', ledgerRows);

            this.setStatus('income-status', 'Income added and split successfully.', 'good');
            event.target.reset();
            await this.renderModules();
        } catch (err) {
            console.error('Add income error:', err);
            this.setStatus('income-status', 'Could not add income. Check the browser console.', 'bad');
        } finally {
            this.setBusy(button, false);
        }
    }

    async addExpense(event) {
        event.preventDefault();

        const description = document.getElementById('expense-description').value.trim();
        const amount = this.parseNumber(document.getElementById('expense-amount').value);
        const bucket = document.getElementById('expense-bucket').value;
        const category = document.getElementById('expense-category').value;
        const date = document.getElementById('expense-date').value;

        if (!description || amount <= 0 || !bucket || !category || !date) {
            this.setStatus('expense-status', 'Please enter a valid expense.', 'bad');
            return;
        }

        const button = event.submitter;
        this.setBusy(button, true, 'Saving...');

        try {
            await SheetsAPI.appendValues(this.spreadsheetId, 'Expenses!A1:F1', [
                date,
                description,
                amount,
                bucket,
                category,
                ''
            ]);

            this.setStatus('expense-status', 'Expense saved successfully.', 'good');
            event.target.reset();
            await this.renderModules();
        } catch (err) {
            console.error('Add expense error:', err);
            this.setStatus('expense-status', 'Could not save expense. Check the browser console.', 'bad');
        } finally {
            this.setBusy(button, false);
        }
    }

    openAllocationRules() {
        const modal = document.getElementById('allocation-modal');
        if (modal) modal.classList.remove('hidden');
    }

    closeAllocationRules() {
        const modal = document.getElementById('allocation-modal');
        if (modal) modal.classList.add('hidden');
    }

    addRuleRow() {
        const list = document.querySelector('.rules-list');
        if (!list) return;

        const wrapper = document.createElement('div');
        wrapper.innerHTML = this.renderRuleRow({ name: '', percent: 0, active: true }).trim();
        const row = wrapper.firstElementChild;
        list.appendChild(row);

        const nameInput = row.querySelector('.rule-name');
        if (nameInput) nameInput.focus();
        this.updateRulesPreview();
    }

    deleteRuleRow(button) {
        const row = button?.closest('.rule-row');
        if (!row) return;

        const remainingRows = document.querySelectorAll('.rule-row').length;
        if (remainingRows <= 1) {
            this.setStatus('rules-status', 'Keep at least one bucket.', 'bad');
            return;
        }

        const bucketName = row.querySelector('.rule-name')?.value.trim();
        const existingBucket = this.state?.buckets?.find(bucket => bucket.name.toLowerCase() === String(bucketName || '').toLowerCase());

        if (existingBucket && (existingBucket.allocated > 0 || existingBucket.spent > 0 || Math.abs(existingBucket.balance) > 0.001)) {
            const confirmed = confirm(`Delete ${bucketName}? Existing transactions will stay in your sheet history, but this bucket will no longer appear in totals after you save.`);
            if (!confirmed) return;
        }

        row.remove();
        this.updateRulesPreview();
        this.setStatus('rules-status', 'Bucket removed from the draft rules. Click Save Rules to apply.', '');
    }

    updateRulesPreview() {
        const rows = [...document.querySelectorAll('.rule-row')];
        const total = rows.reduce((sum, row) => {
            const active = row.querySelector('.rule-active')?.value || 'TRUE';
            const percent = this.parseNumber(row.querySelector('.rule-percent')?.value);
            return String(active).toUpperCase() === 'FALSE' ? sum : sum + percent;
        }, 0);

        const totalEl = document.getElementById('rules-total-value');
        if (totalEl) {
            totalEl.textContent = this.formatPercent(total);
            totalEl.classList.toggle('good', Math.abs(total - 100) <= 0.001);
            totalEl.classList.toggle('bad', Math.abs(total - 100) > 0.001);
        }
    }

    async saveAllocationRules() {
        const ruleRows = [...document.querySelectorAll('.rule-row')];
        const rows = [['Group', 'Percent', 'Description', 'Active', 'Notes']];
        const seenNames = new Set();

        for (const row of ruleRows) {
            const name = row.querySelector('.rule-name')?.value.trim();
            const percent = this.parseNumber(row.querySelector('.rule-percent')?.value);
            const active = row.querySelector('.rule-active')?.value || 'TRUE';

            if (!name) continue;

            const key = name.toLowerCase();
            if (seenNames.has(key)) {
                this.setStatus('rules-status', `Duplicate bucket name: ${name}`, 'bad');
                return;
            }

            seenNames.add(key);
            rows.push([name, percent, `${name} bucket`, active, '']);
        }

        if (rows.length <= 1) {
            this.setStatus('rules-status', 'Add at least one bucket before saving.', 'bad');
            return;
        }

        const total = rows.slice(1)
            .filter(row => String(row[3]).toUpperCase() !== 'FALSE')
            .reduce((sum, row) => sum + this.parseNumber(row[1]), 0);

        if (Math.abs(total - 100) > 0.001) {
            const proceed = confirm(`Your active rules add up to ${this.formatPercent(total)}, not 100%. Save anyway?`);
            if (!proceed) return;
        }

        try {
            await SheetsAPI.clearRange(this.spreadsheetId, 'AllocationGroups!A1:E50');
            await SheetsAPI.updateValues(this.spreadsheetId, `AllocationGroups!A1:E${rows.length}`, rows);
            this.closeAllocationRules();
            await this.renderModules();
        } catch (err) {
            console.error('Save rules error:', err);
            this.setStatus('rules-status', 'Could not save allocation rules.', 'bad');
        }
    }


    async openShareModal() {
        const modal = document.getElementById('share-modal');
        if (modal) modal.classList.remove('hidden');
        await this.loadSharePermissions();
    }

    closeShareModal() {
        const modal = document.getElementById('share-modal');
        if (modal) modal.classList.add('hidden');
    }

    async loadSharePermissions() {
        const list = document.getElementById('share-permissions-list');
        if (!list) return;

        list.innerHTML = '<p class="muted-text">Loading access list...</p>';

        try {
            const permissions = await PermissionsManager.getPermissions(this.spreadsheetId);

            if (!permissions.length) {
                list.innerHTML = '<p class="muted-text">No permissions found.</p>';
                return;
            }

            list.innerHTML = permissions.map(permission => this.renderPermissionRow(permission)).join('');
        } catch (err) {
            console.error('Load permissions error:', err);
            list.innerHTML = '<p class="form-status bad">Could not load current access.</p>';
        }
    }

    renderPermissionRow(permission) {
        const label = permission.emailAddress || permission.displayName || permission.type || 'Unknown user';
        const role = permission.role || 'unknown';
        const canRemove = role !== 'owner' && permission.id;

        return `
            <div class="permission-row">
                <div class="permission-meta">
                    <strong>${this.escapeHtml(label)}</strong>
                    <small>${this.escapeHtml(role)}</small>
                </div>
                ${canRemove ? `<button class="btn-danger subtle compact-button" onclick="budgetModule.removeSharePermission('${this.escapeHtml(permission.id)}')">Remove</button>` : '<span class="owner-pill">Owner</span>'}
            </div>
        `;
    }

    async shareBudget(event) {
        event.preventDefault();

        const textarea = document.getElementById('share-emails');
        const roleSelect = document.getElementById('share-role');
        const button = event.submitter;
        const statusId = 'share-status';

        const emails = (textarea?.value || '')
            .split(/[,;\n]+/)
            .map(email => email.trim())
            .filter(Boolean);

        const uniqueEmails = [...new Set(emails)];
        const role = roleSelect?.value || 'writer';

        if (!uniqueEmails.length) {
            this.setStatus(statusId, 'Enter at least one email address.', 'bad');
            return;
        }

        this.setBusy(button, true, 'Sharing...');

        try {
            for (const email of uniqueEmails) {
                await PermissionsManager.shareSheet(this.spreadsheetId, email, role);
            }

            this.setStatus(statusId, `Shared with ${uniqueEmails.length} friend${uniqueEmails.length === 1 ? '' : 's'}.`, 'good');
            if (textarea) textarea.value = '';
            await this.loadSharePermissions();
        } catch (err) {
            console.error('Share error:', err);
            this.setStatus(statusId, err.result?.error?.message || err.message || 'Could not share this budget.', 'bad');
        } finally {
            this.setBusy(button, false);
        }
    }

    async removeSharePermission(permissionId) {
        const confirmed = confirm('Remove this person from the budget?');
        if (!confirmed) return;

        try {
            await PermissionsManager.removePermission(this.spreadsheetId, permissionId);
            await this.loadSharePermissions();
        } catch (err) {
            console.error('Remove permission error:', err);
            alert('Could not remove this permission.');
        }
    }

    async copyShareLink() {
        const input = document.getElementById('share-link');
        if (!input) return;

        try {
            await navigator.clipboard.writeText(input.value);
            this.setStatus('share-status', 'Link copied. Friend still needs Drive access from sharing above.', 'good');
        } catch {
            input.select();
            document.execCommand('copy');
            this.setStatus('share-status', 'Link copied. Friend still needs Drive access from sharing above.', 'good');
        }
    }

    async resetBudget() {
        const confirmed = confirm('Reset this budget? This clears income, expenses, and allocation history, but keeps your allocation rules.');
        if (!confirmed) return;

        try {
            await Promise.all([
                SheetsAPI.clearRange(this.spreadsheetId, 'Income!A2:E1000'),
                SheetsAPI.clearRange(this.spreadsheetId, 'Expenses!A2:F1000'),
                SheetsAPI.clearRange(this.spreadsheetId, 'AllocationLedger!A2:G2000')
            ]);
            await this.renderModules();
        } catch (err) {
            console.error('Reset error:', err);
            alert('Could not reset this budget.');
        }
    }

    exportTransactions() {
        const rows = [
            ['Date', 'Description', 'Bucket', 'Amount', 'Type'],
            ...this.state.transactions.map(item => [item.date, item.description, item.bucket, item.amount, item.type])
        ];

        const csv = rows.map(row => row.map(cell => `"${String(cell).replaceAll('"', '""')}"`).join(',')).join('\n');
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `smartbudget-transactions-${this.toInputDate(new Date())}.csv`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
    }

    setTransactionSearch(value) {
        this.activeSearch = value;
        this.refreshTransactionsOnly();
    }

    setTransactionFilter(value) {
        this.activeTransactionFilter = value;
        this.refreshTransactionsOnly();
    }

    refreshTransactionsOnly() {
        const panel = document.querySelector('.transaction-panel');
        if (!panel) return;
        panel.outerHTML = this.renderTransactions();
        const input = document.getElementById('transaction-search');
        if (input) {
            input.focus();
            input.selectionStart = input.selectionEnd = input.value.length;
        }
    }

    parseGroups(rows) {
        const body = rows.slice(1);
        const groups = body
            .map(row => ({
                name: row[0] || '',
                percent: this.parseNumber(row[1]),
                description: row[2] || '',
                active: String(row[3] || 'TRUE').toUpperCase() !== 'FALSE',
                notes: row[4] || ''
            }))
            .filter(group => group.name);

        return groups.length ? groups : [
            { name: 'Spending', percent: 50, description: '', active: true, notes: '' },
            { name: 'Savings', percent: 20, description: '', active: true, notes: '' },
            { name: 'Investment', percent: 20, description: '', active: true, notes: '' },
            { name: 'Emergency Fund', percent: 10, description: '', active: true, notes: '' }
        ];
    }

    parseIncome(rows) {
        return rows.slice(1)
            .map(row => ({
                date: row[0] || '',
                description: row[1] || row[1] || 'Income',
                amount: this.parseNumber(row[2]),
                category: row[3] || '',
                notes: row[4] || ''
            }))
            .filter(row => row.date || row.description || row.amount > 0);
    }

    parseExpenses(rows) {
        return rows.slice(1)
            .map(row => ({
                date: row[0] || '',
                description: row[1] || 'Expense',
                amount: this.parseNumber(row[2]),
                bucket: row[3] || 'Spending',
                category: row[4] || 'General',
                notes: row[5] || ''
            }))
            .filter(row => row.date || row.description || row.amount > 0);
    }

    parseLedger(rows) {
        return rows.slice(1)
            .map(row => ({
                date: row[0] || '',
                incomeAmount: this.parseNumber(row[1]),
                group: row[2] || '',
                percent: this.parseNumber(row[3]),
                amount: this.parseNumber(row[4]),
                source: row[5] || '',
                createdBy: row[6] || ''
            }))
            .filter(row => row.group && row.amount > 0);
    }

    parseCategories(rows) {
        const categories = rows.slice(1)
            .map(row => row[0])
            .filter(Boolean);

        return categories.length ? categories : ['Food & Dining', 'Transport', 'Shopping', 'Bills', 'Entertainment', 'General'];
    }

    setBusy(button, busy, text = 'Saving...') {
        if (!button) return;

        if (busy) {
            button.dataset.originalText = button.textContent;
            button.textContent = text;
            button.disabled = true;
        } else {
            button.textContent = button.dataset.originalText || button.textContent;
            button.disabled = false;
        }
    }

    setStatus(id, message, type) {
        const el = document.getElementById(id);
        if (!el) return;
        el.textContent = message;
        el.className = `form-status ${type || ''}`;
    }

    parseNumber(value) {
        const number = parseFloat(String(value ?? '').replace(/[^0-9.-]/g, ''));
        return Number.isFinite(number) ? number : 0;
    }

    formatMoney(value) {
        return new Intl.NumberFormat('en-SG', {
            style: 'currency',
            currency: 'SGD'
        }).format(this.parseNumber(value));
    }

    formatPercent(value) {
        const number = this.parseNumber(value);
        return `${Number.isInteger(number) ? number : number.toFixed(2)}%`;
    }

    formatLongDate(date) {
        return date.toLocaleDateString('en-SG', {
            weekday: 'long',
            month: 'long',
            day: 'numeric',
            year: 'numeric'
        });
    }

    toInputDate(date) {
        const offsetDate = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
        return offsetDate.toISOString().slice(0, 10);
    }

    escapeHtml(value) {
        return String(value ?? '')
            .replaceAll('&', '&amp;')
            .replaceAll('<', '&lt;')
            .replaceAll('>', '&gt;')
            .replaceAll('"', '&quot;')
            .replaceAll("'", '&#039;');
    }
}
