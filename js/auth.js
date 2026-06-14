let currentUser = null;
let accessToken = null;
let tokenClient = null;
let gapiReadyPromise = null;
let hasTriedSilentToken = false;

const USER_STORAGE_KEY = 'budget_app_saved_user';
const TOKEN_STORAGE_KEY = 'budget_app_access_token';
const CONSENT_STORAGE_KEY = 'budget_app_google_consent_granted';
const TOKEN_EXPIRY_BUFFER_MS = 60 * 1000;

function decodeJwt(token) {
    const base64Url = token.split('.')[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload = decodeURIComponent(
        atob(base64)
            .split('')
            .map(char => '%' + ('00' + char.charCodeAt(0).toString(16)).slice(-2))
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
    if (!tokenResponse?.access_token) return;

    const expiresInSeconds = Number(tokenResponse.expires_in || 3600);
    const expiresAt = Date.now() + expiresInSeconds * 1000;

    localStorage.setItem(TOKEN_STORAGE_KEY, JSON.stringify({
        accessToken: tokenResponse.access_token,
        expiresAt,
        scopes: CONFIG.SCOPES
    }));

    localStorage.setItem(CONSENT_STORAGE_KEY, 'true');
}

function loadSavedAccessToken() {
    try {
        const raw = localStorage.getItem(TOKEN_STORAGE_KEY);
        if (!raw) return null;

        const saved = JSON.parse(raw);
        const hasToken = Boolean(saved.accessToken);
        const isNotExpired = Number(saved.expiresAt || 0) > Date.now() + TOKEN_EXPIRY_BUFFER_MS;
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

function setAuthStatus(message) {
    const status = document.getElementById('auth-status');
    if (status) status.textContent = message;
}

function showReconnectButton(show) {
    const btn = document.getElementById('reconnect-sheets-btn');
    if (btn) btn.classList.toggle('hidden', !show);
}

function handleCredentialResponse(response) {
    console.log('Credential received:', response);

    if (!response || !response.credential) {
        setAuthStatus('Sign-in failed. Please try again.');
        showReconnectButton(false);
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
    showReconnectButton(false);

    const promptMode = hasGrantedConsentBefore() ? '' : 'consent';
    AuthManager.requestAccessToken(promptMode);
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
                        gapi.client.setToken({ access_token: accessToken });
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
        if (!tokenClient) {
            console.error('Token client is not ready yet.');
            setAuthStatus('Google login is still loading. Please try again in a second.');
            return;
        }

        tokenClient.requestAccessToken({ prompt: promptMode });
    }

    static reconnectSheets() {
        const savedUser = loadSavedUser();
        if (savedUser && !currentUser) currentUser = savedUser;

        setAuthStatus('Connecting Google Sheets access...');
        showReconnectButton(false);
        AuthManager.requestAccessToken(hasGrantedConsentBefore() ? '' : 'consent');
    }

    static async ensureAccessToken() {
        if (accessToken) return accessToken;

        const savedToken = loadSavedAccessToken();
        if (savedToken) {
            accessToken = savedToken;
            if (typeof gapi !== 'undefined' && gapi.client) {
                gapi.client.setToken({ access_token: accessToken });
            }
            return accessToken;
        }

        if (!currentUser) currentUser = loadSavedUser();
        if (!currentUser) throw new Error('User is not signed in.');

        AuthManager.reconnectSheets();
        return null;
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

function renderGoogleButtons() {
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
            width: 250,
            logo_alignment: 'left',
            button_auto_select: true,
            use_fedcm_for_button: true
        });
    });
}

function initGoogleAuth() {
    const waitForGoogle = () => {
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
            callback: async tokenResponse => {
                console.log('Token callback fired:', tokenResponse);

                if (!tokenResponse || tokenResponse.error) {
                    console.warn('Token was not granted automatically:', tokenResponse);
                    clearSavedAccessToken();
                    setAuthStatus('You are remembered on this browser, but Google Sheets access expired. Click Reconnect Sheets.');
                    showReconnectButton(true);
                    app.showLogin();
                    return;
                }

                accessToken = tokenResponse.access_token;
                saveAccessToken(tokenResponse);
                showReconnectButton(false);

                if (typeof gapi !== 'undefined' && gapi.client) {
                    gapi.client.setToken({ access_token: accessToken });
                }

                await app.onAuthSuccess();
            },
            error_callback: err => {
                console.warn('Token error:', err);
                clearSavedAccessToken();
                setAuthStatus('You are remembered on this browser, but Google Sheets access expired. Click Reconnect Sheets.');
                showReconnectButton(true);
                app.showLogin();
            }
        });

        renderGoogleButtons();

        const savedUser = loadSavedUser();
        const savedToken = loadSavedAccessToken();

        if (savedUser && savedToken) {
            currentUser = savedUser;
            accessToken = savedToken;
            setAuthStatus(`Welcome back, ${savedUser.name}. Opening your budget...`);
            showReconnectButton(false);
            app.onAuthSuccess();
            return;
        }

        if (savedUser && !hasTriedSilentToken) {
            currentUser = savedUser;
            hasTriedSilentToken = true;
            setAuthStatus(`Welcome back, ${savedUser.name}. Trying to reconnect Google Sheets automatically...`);
            showReconnectButton(false);

            // Try once without showing the account picker. If the browser blocks it or the
            // Google token has expired, the callback below shows the Reconnect Sheets button.
            AuthManager.requestAccessToken('');
            return;
        }

        google.accounts.id.prompt(notification => {
            if (notification.isNotDisplayed?.() || notification.isSkippedMoment?.()) {
                setAuthStatus('Sign in once. The app will remember this browser next time.');
            }
        });
    };

    waitForGoogle();
}

document.addEventListener('DOMContentLoaded', initGoogleAuth);
