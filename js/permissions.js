class PermissionsManager {
    static getBudgetMarkerQuery() {
        return [
            `appProperties has { key='${CONFIG.APP_MARKER_KEY}' and value='${CONFIG.APP_MARKER_VALUE}' }`,
            `appProperties has { key='${CONFIG.APP_TYPE_KEY}' and value='${CONFIG.APP_TYPE_VALUE}' }`
        ].join(' and ');
    }

    static async getBudgetFile(spreadsheetId) {
        try {
            const response = await gapi.client.drive.files.get({
                fileId: spreadsheetId,
                fields: 'id,name,owners,webViewLink,createdTime,modifiedTime,appProperties,trashed,mimeType'
            });

            return response.result || null;
        } catch (err) {
            console.error('Could not read Drive file metadata:', err);
            return null;
        }
    }

    static isMarkedBudgetFile(file) {
        const props = file?.appProperties || {};

        return file?.mimeType === 'application/vnd.google-apps.spreadsheet' &&
            !file?.trashed &&
            props[CONFIG.APP_MARKER_KEY] === CONFIG.APP_MARKER_VALUE &&
            props[CONFIG.APP_TYPE_KEY] === CONFIG.APP_TYPE_VALUE;
    }

    static async assertMarkedBudgetFile(spreadsheetId) {
        const file = await this.getBudgetFile(spreadsheetId);

        if (!this.isMarkedBudgetFile(file)) {
            throw new Error(`This Google Sheet was not created by ${CONFIG.APP_DISPLAY_NAME}.`);
        }

        return file;
    }

    static async shareSheet(spreadsheetId, email, role = 'writer') {
        await this.assertMarkedBudgetFile(spreadsheetId);

        const driveResponse = await gapi.client.drive.permissions.create({
            fileId: spreadsheetId,
            resource: {
                type: 'user',
                role: role,
                emailAddress: email
            },
            sendNotificationEmail: true,
            fields: 'id,emailAddress,role,displayName,type'
        });

        const user = AuthManager.getCurrentUser();
        const timestamp = new Date().toISOString();

        try {
            await SheetsAPI.appendValues(spreadsheetId, 'Config!A6:E6', [
                email,
                role,
                timestamp,
                user?.email || '',
                `Shared from ${CONFIG.APP_DISPLAY_NAME}`
            ]);
        } catch (err) {
            console.warn('Budget was shared, but the share log could not be updated:', err);
        }

        return driveResponse.result;
    }

    static async getPermissions(spreadsheetId) {
        try {
            await this.assertMarkedBudgetFile(spreadsheetId);

            const response = await gapi.client.drive.permissions.list({
                fileId: spreadsheetId,
                fields: 'permissions(id,emailAddress,role,displayName,type,deleted)'
            });

            return (response.result.permissions || []).filter(permission => !permission.deleted);
        } catch (e) {
            console.error('Error fetching permissions:', e);
            return [];
        }
    }

    static async removePermission(spreadsheetId, permissionId) {
        await this.assertMarkedBudgetFile(spreadsheetId);

        await gapi.client.drive.permissions.delete({
            fileId: spreadsheetId,
            permissionId: permissionId
        });
    }

    static async getSharedWithMe() {
        const response = await gapi.client.drive.files.list({
            q: [
                "mimeType='application/vnd.google-apps.spreadsheet'",
                'sharedWithMe=true',
                'trashed=false',
                this.getBudgetMarkerQuery()
            ].join(' and '),
            fields: 'files(id,name,owners,webViewLink,createdTime,modifiedTime,appProperties)',
            orderBy: 'modifiedTime desc',
            pageSize: 50
        });

        return response.result.files || [];
    }

    static async getMySheets() {
        const response = await gapi.client.drive.files.list({
            q: [
                "mimeType='application/vnd.google-apps.spreadsheet'",
                "'me' in owners",
                'trashed=false',
                this.getBudgetMarkerQuery()
            ].join(' and '),
            fields: 'files(id,name,webViewLink,createdTime,modifiedTime,owners,appProperties)',
            orderBy: 'modifiedTime desc',
            pageSize: 50
        });

        return response.result.files || [];
    }
}
