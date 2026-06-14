const CONFIG = {
    // Google Cloud Console → APIs & Services → Credentials → OAuth 2.0 Client IDs
    CLIENT_ID: '863084550726-jf5764dn7dkual4dsr5inac824ji70uf.apps.googleusercontent.com',

    // Google Cloud Console → APIs & Services → Credentials → API Keys
    API_KEY: 'AIzaSyAwAW0-4ngE2jojf2ZORERoGCU84H0FrNg',

    // App identity used for Google Drive filtering.
    // Only sheets created and marked by this app will show in the dashboard.
    APP_DISPLAY_NAME: 'SheZ Budgetting',
    APP_SHEET_PREFIX: 'SheZ_Budgetting',
    APP_MARKER_KEY: 'shezBudgettingApp',
    APP_MARKER_VALUE: 'true',
    APP_TYPE_KEY: 'shezBudgettingType',
    APP_TYPE_VALUE: 'budget',

    // Permissions needed by the app.
    SCOPES: 'https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/drive.metadata.readonly https://www.googleapis.com/auth/userinfo.profile',

    DISCOVERY_DOCS: [
        'https://sheets.googleapis.com/$discovery/rest?version=v4',
        'https://www.googleapis.com/discovery/v1/apis/drive/v3/rest'
    ]
};
