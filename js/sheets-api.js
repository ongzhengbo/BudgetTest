class SheetsAPI {
    static async createBudgetSheet(username) {
        const sheetName = `${CONFIG.APP_SHEET_PREFIX}_${username}_${Date.now()}`;

        const response = await gapi.client.sheets.spreadsheets.create({
            properties: { title: sheetName },
            sheets: [
                { properties: { title: 'Config', gridProperties: { rowCount: 30, columnCount: 10 } } },
                { properties: { title: 'Income', gridProperties: { rowCount: 200, columnCount: 5 } } },
                { properties: { title: 'Expenses', gridProperties: { rowCount: 300, columnCount: 6 } } },
                { properties: { title: 'Categories', gridProperties: { rowCount: 50, columnCount: 3 } } },
                { properties: { title: 'Goals', gridProperties: { rowCount: 50, columnCount: 5 } } },
                { properties: { title: 'Recurring', gridProperties: { rowCount: 50, columnCount: 6 } } },
                { properties: { title: 'AllocationGroups', gridProperties: { rowCount: 50, columnCount: 5 } } },
                { properties: { title: 'AllocationLedger', gridProperties: { rowCount: 500, columnCount: 7 } } }
            ]
        });

        const spreadsheetId = response.result.spreadsheetId;

        // Mark this file so the dashboard only lists sheets created by SheZ Budgetting.
        await gapi.client.drive.files.update({
            fileId: spreadsheetId,
            resource: {
                appProperties: {
                    [CONFIG.APP_MARKER_KEY]: CONFIG.APP_MARKER_VALUE,
                    [CONFIG.APP_TYPE_KEY]: CONFIG.APP_TYPE_VALUE,
                    appName: CONFIG.APP_DISPLAY_NAME
                }
            },
            fields: 'id, appProperties'
        });

        await this.initializeSheet(spreadsheetId);

        return {
            id: spreadsheetId,
            name: sheetName,
            url: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`
        };
    }

    static async initializeSheet(spreadsheetId) {
        const user = AuthManager.getCurrentUser();
        const now = new Date().toISOString();

        await gapi.client.sheets.spreadsheets.values.batchUpdate({
            spreadsheetId,
            resource: {
                valueInputOption: 'RAW',
                data: [
                    {
                        range: 'Config!A1:J15',
                        values: [
                            ['OWNER', user.email, user.name, now, ''],
                            ['MODULES', 'smartbudget', '', '', '', '', '', '', '', ''],
                            ['', '', '', '', '', '', '', '', '', ''],
                            ['CURRENCY', 'SGD', '', '', '', '', '', '', '', ''],
                            ['SHARED_WITH', 'Email', 'Permission', 'Added', '', '', '', '', '', ''],
                            ['', '', '', '', '', '', '', '', '', ''],
                            ['SCHEMA_VERSION', '3', '', '', '', '', '', '', '', '']
                        ]
                    },
                    {
                        range: 'Income!A1:E1',
                        values: [['Date', 'Description', 'Amount', 'Category', 'Notes']]
                    },
                    {
                        range: 'Expenses!A1:F1',
                        values: [['Date', 'Description', 'Amount', 'Bucket', 'Category', 'Notes']]
                    },
                    {
                        range: 'Categories!A1:C6',
                        values: [
                            ['Category', 'Type', 'Budget Limit'],
                            ['Food & Dining', 'Expense', ''],
                            ['Transport', 'Expense', ''],
                            ['Shopping', 'Expense', ''],
                            ['Bills', 'Expense', ''],
                            ['Entertainment', 'Expense', '']
                        ]
                    },
                    {
                        range: 'Goals!A1:E1',
                        values: [['Goal Name', 'Target Amount', 'Current Amount', 'Deadline', 'Status']]
                    },
                    {
                        range: 'Recurring!A1:F1',
                        values: [['Name', 'Amount', 'Frequency', 'Next Date', 'Category', 'Active']]
                    },
                    {
                        range: 'AllocationGroups!A1:E5',
                        values: this.defaultAllocationRows()
                    },
                    {
                        range: 'AllocationLedger!A1:G1',
                        values: [['Date', 'Income Amount', 'Group', 'Percent', 'Allocated Amount', 'Source', 'Created By']]
                    }
                ]
            }
        });
    }

    static defaultAllocationRows() {
        return [
            ['Group', 'Percent', 'Description', 'Active', 'Notes'],
            ['Spending', '50', 'Daily spending bucket', 'TRUE', ''],
            ['Savings', '20', 'Savings after income', 'TRUE', ''],
            ['Investment', '20', 'Money planned for investing later', 'TRUE', ''],
            ['Emergency Fund', '10', 'Emergency cash buffer', 'TRUE', '']
        ];
    }

    static async ensureBudgetSchema(spreadsheetId) {
        const spreadsheet = await gapi.client.sheets.spreadsheets.get({
            spreadsheetId,
            fields: 'sheets.properties.title'
        });

        const existingSheets = new Set(
            (spreadsheet.result.sheets || []).map(sheet => sheet.properties.title)
        );

        const requiredSheets = [
            { title: 'Income', rowCount: 200, columnCount: 5 },
            { title: 'Expenses', rowCount: 300, columnCount: 6 },
            { title: 'Categories', rowCount: 50, columnCount: 3 },
            { title: 'AllocationGroups', rowCount: 50, columnCount: 5 },
            { title: 'AllocationLedger', rowCount: 500, columnCount: 7 }
        ];

        const requests = requiredSheets
            .filter(sheet => !existingSheets.has(sheet.title))
            .map(sheet => ({
                addSheet: {
                    properties: {
                        title: sheet.title,
                        gridProperties: {
                            rowCount: sheet.rowCount,
                            columnCount: sheet.columnCount
                        }
                    }
                }
            }));

        if (requests.length) {
            await gapi.client.sheets.spreadsheets.batchUpdate({
                spreadsheetId,
                resource: { requests }
            });
        }

        await this.ensureDefaultHeaders(spreadsheetId);
    }

    static async ensureDefaultHeaders(spreadsheetId) {
        const income = await this.getValues(spreadsheetId, 'Income!A1:E1');
        if (!income.length) {
            await this.updateValues(spreadsheetId, 'Income!A1:E1', [['Date', 'Description', 'Amount', 'Category', 'Notes']]);
        }

        const expenses = await this.getValues(spreadsheetId, 'Expenses!A1:F1');
        if (!expenses.length) {
            await this.updateValues(spreadsheetId, 'Expenses!A1:F1', [['Date', 'Description', 'Amount', 'Bucket', 'Category', 'Notes']]);
        }

        const groups = await this.getValues(spreadsheetId, 'AllocationGroups!A1:E20');
        const groupBody = groups.slice(1).filter(row => row[0]);
        const groupNames = groupBody.map(row => String(row[0] || '').trim().toLowerCase());
        const hasOldDefaultGroups =
            groupNames.includes('spending') &&
            groupNames.includes('savings') &&
            groupNames.includes('investment') &&
            !groupNames.includes('emergency fund') &&
            groupBody.length <= 3;

        if (!groups.length || groups.length <= 1 || hasOldDefaultGroups) {
            await this.clearRange(spreadsheetId, 'AllocationGroups!A1:E50');
            await this.updateValues(spreadsheetId, 'AllocationGroups!A1:E5', this.defaultAllocationRows());
        }

        const ledger = await this.getValues(spreadsheetId, 'AllocationLedger!A1:G1');
        if (!ledger.length) {
            await this.updateValues(spreadsheetId, 'AllocationLedger!A1:G1', [[
                'Date', 'Income Amount', 'Group', 'Percent', 'Allocated Amount', 'Source', 'Created By'
            ]]);
        }

        const categories = await this.getValues(spreadsheetId, 'Categories!A1:C1');
        if (!categories.length) {
            await this.updateValues(spreadsheetId, 'Categories!A1:C6', [
                ['Category', 'Type', 'Budget Limit'],
                ['Food & Dining', 'Expense', ''],
                ['Transport', 'Expense', ''],
                ['Shopping', 'Expense', ''],
                ['Bills', 'Expense', ''],
                ['Entertainment', 'Expense', '']
            ]);
        }
    }

    static async getValues(spreadsheetId, range) {
        const response = await gapi.client.sheets.spreadsheets.values.get({
            spreadsheetId,
            range
        });

        return response.result.values || [];
    }

    static async updateValues(spreadsheetId, range, values) {
        await gapi.client.sheets.spreadsheets.values.update({
            spreadsheetId,
            range,
            valueInputOption: 'RAW',
            resource: { values }
        });
    }

    static async appendValues(spreadsheetId, range, values) {
        await gapi.client.sheets.spreadsheets.values.append({
            spreadsheetId,
            range,
            valueInputOption: 'RAW',
            insertDataOption: 'INSERT_ROWS',
            resource: { values: [values] }
        });
    }

    static async appendRows(spreadsheetId, range, rows) {
        if (!rows.length) return;

        await gapi.client.sheets.spreadsheets.values.append({
            spreadsheetId,
            range,
            valueInputOption: 'RAW',
            insertDataOption: 'INSERT_ROWS',
            resource: { values: rows }
        });
    }

    static async clearRange(spreadsheetId, range) {
        await gapi.client.sheets.spreadsheets.values.clear({
            spreadsheetId,
            range
        });
    }
}
