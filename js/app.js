let budgetModule = null;
window.budgetModule = null;

const app = {
    currentSheetId: null,
    authReady: false,

    showLogin() {
        this.showView('login-view');
    },

    async onAuthSuccess() {
        console.log('Auth success, initializing app...');

        try {
            await AuthManager.initGapi();
        } catch (err) {
            console.error('Failed to init GAPI:', err);
            alert('Failed to connect to Google APIs. Check your API key.');
            this.showLogin();
            return;
        }

        const user = AuthManager.getCurrentUser();

        if (!user) {
            this.showLogin();
            return;
        }

        this.authReady = true;
        this.updateUserUI(user);
        this.updateDateLabel();

        const routeSheetId = this.getSheetIdFromHash();
        if (routeSheetId) {
            await this.openBudget(routeSheetId, false);
            return;
        }

        await this.showDashboard();
    },

    updateUserUI(user) {
        const authSection = document.getElementById('auth-section');
        const userInfo = document.getElementById('user-info');
        const userName = document.getElementById('user-name');

        if (authSection) authSection.classList.add('hidden');
        if (userInfo) userInfo.classList.remove('hidden');
        if (userName) userName.textContent = user.name;
    },

    showSignedOutUI() {
        const authSection = document.getElementById('auth-section');
        const userInfo = document.getElementById('user-info');

        if (authSection) authSection.classList.remove('hidden');
        if (userInfo) userInfo.classList.add('hidden');
        this.showLogin();
    },

    showView(viewId) {
        ['login-view', 'dashboard-view', 'budget-view'].forEach(id => {
            const view = document.getElementById(id);
            if (!view) return;
            view.classList.toggle('hidden', id !== viewId);
        });

        document.body.classList.toggle('budget-mode', viewId === 'budget-view');
        document.body.classList.toggle('dashboard-mode', viewId === 'dashboard-view');
        document.body.classList.toggle('login-mode', viewId === 'login-view');
    },

    updateDateLabel() {
        const label = document.getElementById('today-label');
        if (!label) return;

        const date = new Date().toLocaleDateString('en-SG', {
            weekday: 'long',
            month: 'long',
            day: 'numeric',
            year: 'numeric'
        });

        label.textContent = date;
    },

    getSheetIdFromHash() {
        const hash = location.hash.replace(/^#/, '');
        const params = new URLSearchParams(hash);
        return params.get('budget');
    },

    setBudgetHash(sheetId) {
        const newHash = `budget=${encodeURIComponent(sheetId)}`;
        if (location.hash.replace(/^#/, '') !== newHash) {
            history.pushState(null, '', `#${newHash}`);
        }
    },

    clearHash() {
        if (location.hash) {
            history.pushState(null, '', location.pathname);
        }
    },

    async showDashboard() {
        this.currentSheetId = null;
        budgetModule = null;
        window.budgetModule = null;

        const budgetDashboard = document.getElementById('budget-dashboard');
        if (budgetDashboard) budgetDashboard.innerHTML = '';

        this.clearHash();
        this.showView('dashboard-view');
        await this.loadDashboard();
    },

    async loadDashboard() {
        try {
            const mySheets = await PermissionsManager.getMySheets();
            const sharedSheets = await PermissionsManager.getSharedWithMe();

            this.renderBudgetList('budget-list', mySheets, true);
            this.renderBudgetList('shared-list', sharedSheets, false);
        } catch (err) {
            console.error('Dashboard load error:', err);
            alert('Could not load your budget list. Check the console for details.');
        }
    },

    renderBudgetList(elementId, sheets, isOwner) {
        const list = document.getElementById(elementId);
        if (!list) return;

        if (!sheets.length) {
            list.innerHTML = `<p class="empty">${isOwner ? 'No budgets yet. Create one.' : 'No shared budgets.'}</p>`;
            return;
        }

        list.innerHTML = sheets.map(sheet => this.createBudgetCard(sheet, isOwner)).join('');
    },

    createBudgetCard(sheet, isOwner) {
        const date = sheet.createdTime
            ? new Date(sheet.createdTime).toLocaleDateString('en-SG')
            : 'Unknown';

        const displayName = sheet.name
            ? sheet.name
                .replace(`${CONFIG.APP_SHEET_PREFIX}_`, '')
                .replace('SmartBudget_', '')
                .replace('Budget_', '')
                .replace(/_\d+$/, '')
            : 'Untitled';

        const ownerText = isOwner
            ? 'Owned by you'
            : `Owner: ${sheet.owners?.[0]?.displayName || 'Unknown'}`;

        return `
            <button class="budget-card" onclick="app.openBudget('${this.escapeAttr(sheet.id)}')">
                <span class="budget-card-icon">▣</span>
                <span class="budget-card-body">
                    <strong>${this.escapeHtml(displayName)}</strong>
                    <small>Created: ${this.escapeHtml(date)}</small>
                    <small>${this.escapeHtml(ownerText)}</small>
                </span>
            </button>
        `;
    },

    async createNewBudget(button) {
        const user = AuthManager.getCurrentUser();
        if (!user) {
            alert('Please sign in first.');
            return;
        }

        const username = user.name
            .replace(/\s+/g, '_')
            .replace(/[^a-zA-Z0-9_]/g, '');

        const originalText = button ? button.textContent : '';
        if (button) {
            button.textContent = 'Creating...';
            button.disabled = true;
        }

        try {
            const sheet = await SheetsAPI.createBudgetSheet(username);
            await this.openBudget(sheet.id);
        } catch (err) {
            console.error('Create error:', err);
            alert('Error creating sheet: ' + (err.message || err.result?.error?.message || 'Unknown error'));
        } finally {
            if (button) {
                button.textContent = originalText;
                button.disabled = false;
            }
        }
    },

    async openBudget(sheetId, updateHash = true) {
        if (!sheetId) return;

        this.currentSheetId = sheetId;
        if (updateHash) this.setBudgetHash(sheetId);

        const budgetDashboard = document.getElementById('budget-dashboard');
        if (budgetDashboard) {
            budgetDashboard.innerHTML = `
                <div class="loading-card">
                    <div class="spinner"></div>
                    <h2>Loading SheZ Budgetting...</h2>
                    <p>Getting your Google Sheet data.</p>
                </div>
            `;
        }

        this.showView('budget-view');

        try {
            await PermissionsManager.assertMarkedBudgetFile(sheetId);

            budgetModule = new BudgetModule(sheetId);
            window.budgetModule = budgetModule;
            await budgetModule.loadConfig();
            await budgetModule.renderModules();
        } catch (err) {
            console.error('Open budget error:', err);

            const message = err.message || 'Could not open this budget. Check Google permissions or sheet access.';
            if (budgetDashboard) {
                budgetDashboard.innerHTML = `
                    <div class="error-card">
                        <h2>Could not open this budget.</h2>
                        <p>${this.escapeHtml(message)}</p>
                        <button class="btn-secondary" onclick="app.showDashboard()">Back to Dashboard</button>
                    </div>
                `;
            }

            alert(message);
        }
    },

    logout() {
        AuthManager.logout();
    },

    escapeHtml(value) {
        return String(value ?? '')
            .replaceAll('&', '&amp;')
            .replaceAll('<', '&lt;')
            .replaceAll('>', '&gt;')
            .replaceAll('"', '&quot;')
            .replaceAll("'", '&#039;');
    },

    escapeAttr(value) {
        return this.escapeHtml(value).replaceAll('`', '&#096;');
    }
};

window.addEventListener('popstate', async () => {
    if (!AuthManager.getCurrentUser()) return;

    const sheetId = app.getSheetIdFromHash();
    if (sheetId) {
        await app.openBudget(sheetId, false);
    } else {
        await app.showDashboard();
    }
});
