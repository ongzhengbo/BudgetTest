let currentUser = null;
let accessToken = null;
let tokenClient = null;
let gapiReadyPromise = null;
let hasTriedSilentToken = false;

const USER_STORAGE_KEY = 'budget_app_saved_user';
const TOKEN_STORAGE_KEY = 'budget_app_access_token';
const CONSENT_STORAGE_KEY = 'budget_app_google_consent_granted';
const TOKEN_EXPIRY_BUFFER_MS = 60 * 1000;

// ---------- JWT / STORAGE ----------

function decodeJwt(token) {
    const base64Url = token.split('.')[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');

    const jsonPayload = decodeURIComponent(
        atob(base64)
            .split('')
            .map(char => {
                return '%' + ('00' + char.charCodeAt(0).toString(16)).slice(-2);
            })
            .join('')
    );

    return JSON.parse(jsonPayload);
}

function saveUser(user) {
    localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(user));
}

function loadSavedUser() {
    try {
        const saved = localStorage.getItem(USER_STORAGE_KEY);
        return saved ? JSON.parse(saved) : null;
    } catch {
        return null;
    }
}

function clearSavedUser() {
    localStorage.removeItem(USER_STORAGE_KEY);
}

function saveAccessToken(tokenResponse) {
    if (!tokenResponse || !tokenResponse.access_token) return;

    const expiresInSeconds = Number(tokenResponse.expires_in || 3600);
    const expiresAt = Date.now() + expiresInSeconds * 1000;

    localStorage.setItem(
        TOKEN_STORAGE_KEY,
        JSON.stringify({
            accessToken: tokenResponse.access_token,
            expiresAt,
            scopes: CONFIG.SCOPES
        })
    );

    localStorage.setItem(CONSENT_STORAGE_KEY, 'true');
}

function loadSavedAccessToken() {
    try {
        const raw = localStorage.getItem(TOKEN_STORAGE_KEY);
        if (!raw) return null;

        const saved = JSON.parse(raw);

        const hasToken = Boolean(saved.accessToken);
        const isNotExpired =
            Number(saved.expiresAt || 0) > Date.now() + TOKEN_EXPIRY_BUFFER_MS;
        const scopeMatches = saved.scopes === CONFIG.SCOPES;

        if (!hasToken || !isNotExpired || !scopeMatches) {
            clearSavedAccessToken();
            return null;
        }

        return saved.accessToken;
    } catch {
        clearSavedAccessToken();
        return null;
    }
}

function clearSavedAccessToken() {
    localStorage.removeItem(TOKEN_STORAGE_KEY);
}

function hasGrantedConsentBefore() {
    return localStorage.getItem(CONSENT_STORAGE_KEY) === 'true';
}

function clearConsentFlag() {
    localStorage.removeItem(CONSENT_STORAGE_KEY);
}

// ---------- UI HELPERS ----------

function setAuthStatus(message) {
    const status = document.getElementById('auth-status');
    if (status) status.textContent = message;
}

function showReconnectButton(show) {
    const reconnectBtn = document.getElementById('reconnect-sheets-btn');
    const resetBtn = document.getElementById('reset-google-login-btn');

    if (reconnectBtn) reconnectBtn.classList.toggle('hidden', !show);
    if (resetBtn) resetBtn.classList.toggle('hidden', !show);
}

function showLoginScreen() {
    const loginView = document.getElementById('login-view');
    const dashboardView = document.getElementById('dashboard-view');
    const budgetView = document.getElementById('budget-view');

    if (loginView) loginView.classList.remove('hidden');
    if (dashboardView) dashboardView.classList.add('hidden');
    if (budgetView) budgetView.classList.add('hidden');

    if (window.app && typeof app.showLogin === 'function') {
        app.showLogin();
    }
}

function hideLoginRecoveryButtons() {
    showReconnectButton(false);
}

function renderGoogleButtons() {
    if (
        typeof google === 'undefined' ||
        !google.accounts ||
        !google.accounts.id
    ) {
        return;
    }

    const buttonIds = ['signin-btn', 'google-signin-btn'];

    buttonIds.forEach(id => {
        const container = document.getElementById(id);
        if (!container) return;

        container.innerHTML = '';

        google.accounts.id.renderButton(container, {
            type: 'standard',
            theme: id === 'google-signin-btn' ? 'filled_blue' : 'outline',
            size: 'large',
            text: 'signin_with',
            shape: id === 'google-signin-btn' ? 'pill' : 'rectangular',
            width: 260,
            logo_alignment: 'left'
        });
    });
}

// ---------- GOOGLE LOGIN ----------

function handleCredentialResponse(response) {
    console.log('Credential received:', response);

    if (!response || !response.credential) {
        setAuthStatus('Google sign-in failed. Please try again.');
        showReconnectButton(false);
        renderGoogleButtons();
        return;
    }

    const payload = decodeJwt(response.credential);

    currentUser = {
        id: payload.sub,
        name: payload.name,
        email: payload.email,
        picture: payload.picture
    };

    saveUser(currentUser);

    setAuthStatus('Signed in. Connecting Google Sheets access...');
    hideLoginRecoveryButtons();

    AuthManager.requestAccessToken('consent').catch(err => {
        console.warn('Failed to get access token after sign-in:', err);

        clearSavedAccessToken();
        setAuthStatus(
            'Google profile signed in, but Google Sheets access was not granted. Click Reconnect Google Sheets.'
        );
        showReconnectButton(true);
        renderGoogleButtons();
        showLoginScreen();
    });
}

class AuthManager {
    static getCurrentUser() {
        return currentUser;
    }

    static getAccessToken() {
        return accessToken;
    }

    static hasSavedUser() {
        return Boolean(loadSavedUser());
    }

    static async initGapi() {
        if (gapiReadyPromise) return gapiReadyPromise;

        gapiReadyPromise = new Promise((resolve, reject) => {
            if (typeof CONFIG === 'undefined') {
                reject(
                    new Error(
                        'CONFIG is not defined. Check js/config.js and make sure it loads before auth.js.'
                    )
                );
                return;
            }

            if (typeof gapi === 'undefined') {
                reject(new Error('Google API script has not loaded yet.'));
                return;
            }

            gapi.load('client', async () => {
                try {
                    await gapi.client.init({
                        apiKey: CONFIG.API_KEY,
                        discoveryDocs: CONFIG.DISCOVERY_DOCS
                    });

                    if (accessToken) {
                        gapi.client.setToken({
                            access_token: accessToken
                        });
                    }

                    console.log('GAPI initialized');
                    resolve();
                } catch (err) {
                    console.error('GAPI init failed:', err);
                    reject(err);
                }
            });
        });

        return gapiReadyPromise;
    }

    static requestAccessToken(promptMode = '') {
        return new Promise((resolve, reject) => {
            if (!tokenClient) {
                const err = new Error('Google token client is not ready yet.');
                console.error(err);
                setAuthStatus('Google login is still loading. Please try again in a second.');
                reject(err);
                return;
            }

            tokenClient.callback = async tokenResponse => {
                console.log('Token callback fired:', tokenResponse);

                if (!tokenResponse || tokenResponse.error) {
                    clearSavedAccessToken();

                    const err = tokenResponse || new Error('Google token was not granted.');
                    console.warn('Token was not granted:', err);

                    setAuthStatus(
                        'Google Sheets access was not granted. Click Reconnect Google Sheets.'
                    );
                    showReconnectButton(true);
                    renderGoogleButtons();
                    showLoginScreen();

                    reject(err);
                    return;
                }

                accessToken = tokenResponse.access_token;
                saveAccessToken(tokenResponse);
                hideLoginRecoveryButtons();

                if (typeof gapi !== 'undefined' && gapi.client) {
                    gapi.client.setToken({
                        access_token: accessToken
                    });
                }

                try {
                    if (window.app && typeof app.onAuthSuccess === 'function') {
                        await app.onAuthSuccess();
                    }

                    resolve(accessToken);
                } catch (err) {
                    console.error('App auth success failed:', err);
                    reject(err);
                }
            };

            try {
                tokenClient.requestAccessToken({
                    prompt: promptMode
                });
            } catch (err) {
                console.error('requestAccessToken failed:', err);

                clearSavedAccessToken();
                setAuthStatus(
                    'Could not open Google Sheets permission popup. Please try again.'
                );
                showReconnectButton(true);
                renderGoogleButtons();
                showLoginScreen();

                reject(err);
            }
        });
    }

    static reconnectSheets() {
        const savedUser = loadSavedUser();

        if (savedUser && !currentUser) {
            currentUser = savedUser;
        }

        if (!currentUser) {
            setAuthStatus('Please sign in with Google first.');
            renderGoogleButtons();
            showReconnectButton(false);
            showLoginScreen();
            return;
        }

        setAuthStatus('Connecting Google Sheets access...');
        hideLoginRecoveryButtons();

        // Use consent so Google clearly shows the Sheets/Drive permissions again.
        AuthManager.requestAccessToken('consent').catch(err => {
            console.warn('Reconnect failed:', err);

            clearSavedAccessToken();

            setAuthStatus(
                'Google Sheets access was not granted. Try Reset Google Login, then sign in again.'
            );
            showReconnectButton(true);
            renderGoogleButtons();
            showLoginScreen();
        });
    }

    static async ensureAccessToken() {
        if (accessToken) return accessToken;

        const savedToken = loadSavedAccessToken();

        if (savedToken) {
            accessToken = savedToken;

            if (typeof gapi !== 'undefined' && gapi.client) {
                gapi.client.setToken({
                    access_token: accessToken
                });
            }

            return accessToken;
        }

        if (!currentUser) {
            currentUser = loadSavedUser();
        }

        if (!currentUser) {
            throw new Error('User is not signed in.');
        }

        await AuthManager.requestAccessToken('consent');
        return accessToken;
    }

    static resetGoogleLogin() {
        const email = currentUser?.email || loadSavedUser()?.email;

        currentUser = null;
        accessToken = null;
        hasTriedSilentToken = false;

        clearSavedUser();
        clearSavedAccessToken();
        clearConsentFlag();

        if (typeof google !== 'undefined' && google.accounts) {
            google.accounts.id.disableAutoSelect();

            if (email && google.accounts.id.revoke) {
                google.accounts.id.revoke(email, () => {
                    console.log('Google sign-in revoked for this app.');
                });
            }
        }

        setAuthStatus('Google login reset. Please sign in again.');
        showReconnectButton(false);
        renderGoogleButtons();
        showLoginScreen();
    }

    static logout() {
        const email = currentUser?.email;

        currentUser = null;
        accessToken = null;
        hasTriedSilentToken = false;

        clearSavedUser();
        clearSavedAccessToken();
        clearConsentFlag();

        if (typeof google !== 'undefined' && google.accounts) {
            google.accounts.id.disableAutoSelect();

            if (email && google.accounts.id.revoke) {
                google.accounts.id.revoke(email, () => {
                    console.log('Google sign-in revoked for this app.');
                });
            }
        }

        location.href = 'index.html';
    }
}

// ---------- INIT ----------

function initGoogleAuth() {
    const waitForGoogle = () => {
        if (typeof CONFIG === 'undefined') {
            console.error(
                'CONFIG is not defined. Fix js/config.js or make sure it loads before auth.js.'
            );
            setAuthStatus('App config failed to load. Check js/config.js.');
            return;
        }

        if (
            typeof google === 'undefined' ||
            !google.accounts ||
            !google.accounts.id ||
            !google.accounts.oauth2
        ) {
            setTimeout(waitForGoogle, 100);
            return;
        }

        console.log('Google Identity Services ready.');

        google.accounts.id.initialize({
            client_id: CONFIG.CLIENT_ID,
            callback: handleCredentialResponse,
            auto_select: true,
            cancel_on_tap_outside: false,
            use_fedcm_for_prompt: true
        });

        tokenClient = google.accounts.oauth2.initTokenClient({
            client_id: CONFIG.CLIENT_ID,
            scope: CONFIG.SCOPES,
            callback: () => {},
            error_callback: err => {
                console.warn('Token error:', err);

                clearSavedAccessToken();

                setAuthStatus(
                    'Google Sheets access expired or was blocked. Click Reconnect Google Sheets.'
                );
                showReconnectButton(true);
                renderGoogleButtons();
                showLoginScreen();
            }
        });

        renderGoogleButtons();

        const savedUser = loadSavedUser();
        const savedToken = loadSavedAccessToken();

        // Best case: profile + valid token are still cached.
        if (savedUser && savedToken) {
            currentUser = savedUser;
            accessToken = savedToken;

            if (typeof gapi !== 'undefined' && gapi.client) {
                gapi.client.setToken({
                    access_token: accessToken
                });
            }

            setAuthStatus(`Welcome back, ${savedUser.name}. Opening SheZ Budgetting...`);
            hideLoginRecoveryButtons();

            if (window.app && typeof app.onAuthSuccess === 'function') {
                app.onAuthSuccess();
            }

            return;
        }

        // Saved user exists, but token is missing/expired.
        // Do NOT hide the Google button here.
        if (savedUser && !hasTriedSilentToken) {
            currentUser = savedUser;
            hasTriedSilentToken = true;

            setAuthStatus(
                `Welcome back, ${savedUser.name}. Google Sheets access needs to be reconnected.`
            );

            showReconnectButton(true);
            renderGoogleButtons();
            showLoginScreen();

            return;
        }

        // No saved user. Show normal Google sign-in.
        setAuthStatus('Sign in once. The app will remember this browser next time.');
        showReconnectButton(false);
        renderGoogleButtons();
        showLoginScreen();

        google.accounts.id.prompt(notification => {
            if (
                notification.isNotDisplayed?.() ||
                notification.isSkippedMoment?.()
            ) {
                setAuthStatus('Sign in with Google to start using SheZ Budgetting.');
                renderGoogleButtons();
            }
        });
    };

    waitForGoogle();
}

document.addEventListener('DOMContentLoaded', initGoogleAuth);