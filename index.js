/**
 * REI API - Cloud Functions Replacement for Apps Script
 *
 * Endpoints:
 * - POST / with { action: 'ping' } - Health check
 * - POST / with { action: 'getTodos', filter: {} } - Get to-dos
 * - POST / with { action: 'queueTodo', reid, primary, payload } - Add to-do
 * - POST / with { action: 'updateTodo', todoId, updates } - Update to-do
 * - POST / with { action: 'queueNote', reid, primary, payload } - Add note
 * - POST / with { action: 'getAllPropertyLabels' } - Get all property data
 * - POST / with { action: 'getStatusConfig' } - Get status configuration
 */

const express = require('express');
const cors = require('cors');
const { google } = require('googleapis');
const functions = require('@google-cloud/functions-framework');

const app = express();

// Middleware
app.use(cors({ origin: true })); // Allow all origins
app.use(express.json());

// ============================================================================
// CONFIGURATION
// ============================================================================

const CONFIG = {
  SHEETS: {
    PME: '1AlnsbdcNAPK1pCCa_WQnlBicZ-jKl8fFSXSgn5eSOhg',
    WORKFLOW_PROCESSOR: '1MBGcdzYKcE_5VVk07b1iwlhXN0JDqSWv4o-fG29Ie7E'
  },
  TABS: {
    MAIN: 'MAIN',
    TO_DO_MASTER: 'TO_DO_MASTER',
    VAR: 'VAR',
    QUEUE: 'QUEUE'
  }
};

// ============================================================================
// GOOGLE SHEETS AUTH
// ============================================================================

let sheetsClient = null;

async function getSheets() {
  if (sheetsClient) return sheetsClient;

  let auth;

  // Check for service account key in environment variable (JSON string)
  if (process.env.GOOGLE_SERVICE_ACCOUNT_KEY) {
    const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY);
    auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/spreadsheets']
    });
  } else {
    // Fall back to Application Default Credentials (for local dev)
    auth = new google.auth.GoogleAuth({
      scopes: ['https://www.googleapis.com/auth/spreadsheets']
    });
  }

  const authClient = await auth.getClient();
  sheetsClient = google.sheets({ version: 'v4', auth: authClient });
  return sheetsClient;
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function normalizeHeader(h) {
  if (!h) return '';
  return String(h).replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function generateId(prefix = 'ID') {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `${prefix}-${timestamp}-${random}`.toUpperCase();
}

async function getSheetData(spreadsheetId, range) {
  const sheets = await getSheets();
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range
  });
  return response.data.values || [];
}

async function appendRow(spreadsheetId, range, values) {
  const sheets = await getSheets();
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range,
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    resource: { values: [values] }
  });
}

async function updateCell(spreadsheetId, range, value) {
  const sheets = await getSheets();
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range,
    valueInputOption: 'USER_ENTERED',
    resource: { values: [[value]] }
  });
}

// ============================================================================
// API HANDLERS
// ============================================================================

const handlers = {
  // Health check
  ping: async () => {
    return { pong: true, timestamp: new Date().toISOString(), service: 'rei-api' };
  },

  // Get all to-dos
  getTodos: async (data) => {
    const filter = data.filter || {};
    const rows = await getSheetData(CONFIG.SHEETS.PME, `${CONFIG.TABS.TO_DO_MASTER}!A:Z`);

    if (rows.length < 2) {
      return { success: true, todos: [], count: 0, statsByAssignee: {} };
    }

    const headers = rows[0].map(normalizeHeader);
    const headerMap = {};
    headers.forEach((h, i) => { if (h) headerMap[h.toUpperCase().replace(/\s+/g, '_')] = i; });

    const todos = [];
    const statsByAssignee = {};

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const status = String(row[headerMap['TO_DO_STATUS']] || row[headerMap['STATUS']] || 'OPEN').toUpperCase();
      const assignee = row[headerMap['ASSIGNED_TO']] || row[headerMap['WHO']] || 'Unassigned';

      // Count stats
      if (status !== 'DONE' && status !== 'COMPLETED' && status !== 'CLOSED') {
        statsByAssignee[assignee] = (statsByAssignee[assignee] || 0) + 1;
      }

      // Apply filters
      if (filter.status) {
        if (status !== filter.status.toUpperCase()) continue;
      } else {
        if (status === 'DONE' || status === 'COMPLETED' || status === 'CLOSED') continue;
      }

      if (filter.assignee && assignee.toUpperCase() !== filter.assignee.toUpperCase()) continue;
      if (filter.reid && row[headerMap['REID']] !== filter.reid) continue;

      todos.push({
        rowIndex: i + 1,
        todoId: row[headerMap['TO_DO_ID']] || row[headerMap['TODO_ID']] || '',
        reid: row[headerMap['REID']] || '',
        primary: row[headerMap['PRIMARY']] || '',
        action: row[headerMap['ACTION']] || '',
        assignedTo: assignee,
        status: status,
        createdDate: row[headerMap['CREATED_DATE/TIME']] || row[headerMap['CREATED']] || '',
        sourceStatus: row[headerMap['SOURCE_STATUS']] || ''
      });
    }

    return {
      success: true,
      todos: todos.slice(0, filter.limit || 100),
      count: todos.length,
      statsByAssignee,
      timestamp: new Date().toISOString()
    };
  },

  // Queue a new to-do
  queueTodo: async (data) => {
    if (!data.payload || !data.payload.action) {
      throw new Error('Payload with action is required');
    }

    const todoId = generateId('TD');
    const now = new Date().toISOString();

    // Add to QUEUE sheet for processing
    await appendRow(CONFIG.SHEETS.WORKFLOW_PROCESSOR, `${CONFIG.TABS.QUEUE}!A:L`, [
      generateId('WQ'),           // QUEUE_ID
      now,                        // QUEUED_AT
      'TODO_CREATE',              // WORK_TYPE
      data.reid || '',            // REID
      data.primary || '',         // PRIMARY
      JSON.stringify(data.payload), // PAYLOAD
      'PENDING',                  // STATUS
      '', '', '', '', 0           // STARTED_AT, COMPLETED_AT, RESULT, ERROR, RETRY_COUNT
    ]);

    return {
      success: true,
      todoId,
      message: 'To-do queued for processing',
      timestamp: now
    };
  },

  // Update a to-do
  updateTodo: async (data) => {
    if (!data.todoId) throw new Error('todoId is required');

    const rows = await getSheetData(CONFIG.SHEETS.PME, `${CONFIG.TABS.TO_DO_MASTER}!A:Z`);
    if (rows.length < 2) throw new Error('No to-dos found');

    const headers = rows[0].map(normalizeHeader);
    const headerMap = {};
    headers.forEach((h, i) => { if (h) headerMap[h.toUpperCase().replace(/\s+/g, '_')] = i; });

    const todoIdCol = headerMap['TO_DO_ID'] !== undefined ? headerMap['TO_DO_ID'] : headerMap['TODO_ID'];
    let targetRow = -1;

    for (let i = 1; i < rows.length; i++) {
      if (rows[i][todoIdCol] === data.todoId) {
        targetRow = i + 1;
        break;
      }
    }

    if (targetRow === -1) throw new Error('Todo not found: ' + data.todoId);

    const updates = data.updates || {};
    const updateLog = [];

    if (updates.status !== undefined) {
      const statusCol = headerMap['TO_DO_STATUS'] !== undefined ? headerMap['TO_DO_STATUS'] : headerMap['STATUS'];
      if (statusCol !== undefined) {
        const colLetter = String.fromCharCode(65 + statusCol);
        await updateCell(CONFIG.SHEETS.PME, `${CONFIG.TABS.TO_DO_MASTER}!${colLetter}${targetRow}`, updates.status);
        updateLog.push('status → ' + updates.status);
      }
    }

    return {
      success: true,
      todoId: data.todoId,
      updates: updateLog,
      timestamp: new Date().toISOString()
    };
  },

  // Queue a note
  queueNote: async (data) => {
    if (!data.payload || !data.payload.note) {
      throw new Error('Payload with note is required');
    }

    const now = new Date().toISOString();

    await appendRow(CONFIG.SHEETS.WORKFLOW_PROCESSOR, `${CONFIG.TABS.QUEUE}!A:L`, [
      generateId('WQ'),
      now,
      'NOTE_TRANSFER',
      data.reid || '',
      data.primary || '',
      JSON.stringify(data.payload),
      'PENDING',
      '', '', '', '', 0
    ]);

    return {
      success: true,
      message: 'Note queued for processing',
      timestamp: now
    };
  },

  // Get all property labels/data
  getAllPropertyLabels: async (data) => {
    const rows = await getSheetData(CONFIG.SHEETS.PME, `${CONFIG.TABS.MAIN}!A:ZZ`);
    if (rows.length < 2) {
      return { success: true, properties: {}, count: 0 };
    }

    const headers = rows[0].map(normalizeHeader);
    const headerMap = {};
    headers.forEach((h, idx) => { if (h) headerMap[h] = idx; });

    const reidCol = headerMap['REID'];
    if (reidCol === undefined) throw new Error('REID column not found');

    const properties = {};
    const reids = data.reids ? new Set(data.reids) : null;
    const fields = data.fields ? new Set(data.fields.map(normalizeHeader)) : null;

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const reid = row[reidCol];
      if (!reid) continue;
      if (reids && !reids.has(reid)) continue;

      const propData = {};
      Object.keys(headerMap).forEach(headerName => {
        if (fields && !fields.has(headerName)) return;
        let value = row[headerMap[headerName]];
        if (value instanceof Date) {
          value = value.toISOString().split('T')[0];
        }
        propData[headerName] = value !== undefined && value !== '' ? value : '';
      });

      properties[reid] = propData;
    }

    return {
      success: true,
      properties,
      count: Object.keys(properties).length,
      timestamp: new Date().toISOString()
    };
  },

  // Get status configuration
  getStatusConfig: async () => {
    const rows = await getSheetData(CONFIG.SHEETS.PME, `${CONFIG.TABS.VAR}!A:Z`);
    if (rows.length < 2) {
      return { success: true, statuses: [], hiddenStatuses: [] };
    }

    const headers = rows[0].map(normalizeHeader);
    const headerMap = {};
    headers.forEach((h, i) => { if (h) headerMap[h.toUpperCase().replace(/\s+/g, '_')] = i; });

    const statusCol = headerMap['STATUS_LIST'] !== undefined ? headerMap['STATUS_LIST'] : headerMap['STATUSLIST'];
    const sortCol = headerMap['UI_SORT_SCORE'] !== undefined ? headerMap['UI_SORT_SCORE'] : headerMap['UISORTSCORE'];

    if (statusCol === undefined) {
      return { success: false, error: 'STATUS LIST column not found' };
    }

    const statuses = [];
    const hiddenStatuses = [];

    for (let i = 1; i < rows.length; i++) {
      const status = rows[i][statusCol];
      if (!status || String(status).trim() === '') continue;

      const sortScore = sortCol !== undefined ? rows[i][sortCol] : i;

      if (String(sortScore).toUpperCase() === 'X') {
        hiddenStatuses.push(String(status).trim());
        continue;
      }

      statuses.push({
        status: String(status).trim(),
        sortScore: sortScore === '' || sortScore === null ? 999 : Number(sortScore) || 999
      });
    }

    statuses.sort((a, b) => a.sortScore - b.sortScore);

    return {
      success: true,
      statuses,
      hiddenStatuses,
      timestamp: new Date().toISOString()
    };
  },

  // Get main headers
  getMainHeaders: async () => {
    const rows = await getSheetData(CONFIG.SHEETS.PME, `${CONFIG.TABS.MAIN}!1:1`);
    if (!rows.length) {
      return { success: false, error: 'No headers found' };
    }

    const headers = rows[0];
    const fields = [];

    for (let i = 0; i < headers.length; i++) {
      const normalized = normalizeHeader(headers[i]);
      if (normalized !== '') {
        fields.push({
          name: normalized,
          column: i,
          original: String(headers[i] || '').substring(0, 50)
        });
      }
    }

    return {
      success: true,
      fields,
      count: fields.length,
      timestamp: new Date().toISOString()
    };
  },

  // Update property flag
  updatePropertyFlag: async (data) => {
    if (!data.reid) throw new Error('reid is required');

    const rows = await getSheetData(CONFIG.SHEETS.PME, `${CONFIG.TABS.MAIN}!A:ZZ`);
    if (rows.length < 2) throw new Error('No properties found');

    const headers = rows[0].map(normalizeHeader);
    const headerMap = {};
    headers.forEach((h, i) => { if (h) headerMap[h.toUpperCase()] = i; });

    const reidCol = headerMap['REID'];
    const flagCol = headerMap['FLAG'];

    if (flagCol === undefined) throw new Error('FLAG column not found');

    let targetRow = -1;
    for (let i = 1; i < rows.length; i++) {
      if (rows[i][reidCol] === data.reid) {
        targetRow = i + 1;
        break;
      }
    }

    if (targetRow === -1) throw new Error('Property not found: ' + data.reid);

    const colLetter = String.fromCharCode(65 + flagCol);
    await updateCell(CONFIG.SHEETS.PME, `${CONFIG.TABS.MAIN}!${colLetter}${targetRow}`, data.flagged ? 'TRUE' : 'FALSE');

    return {
      success: true,
      reid: data.reid,
      flagged: data.flagged,
      timestamp: new Date().toISOString()
    };
  }
};

// ============================================================================
// MAIN ROUTE HANDLER
// ============================================================================

app.post('/', async (req, res) => {
  const startTime = Date.now();

  try {
    const { action, ...data } = req.body;

    if (!action) {
      return res.status(400).json({
        success: false,
        error: 'Missing required field: action'
      });
    }

    const handler = handlers[action];
    if (!handler) {
      return res.status(400).json({
        success: false,
        error: 'Unknown action: ' + action
      });
    }

    const result = await handler(data);

    res.json({
      success: true,
      data: result,
      timestamp: new Date().toISOString(),
      duration: Date.now() - startTime
    });

  } catch (error) {
    console.error('API Error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Health check endpoint
app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    service: 'rei-api',
    version: '1.0.0',
    timestamp: new Date().toISOString()
  });
});

// ============================================================================
// CLOUD FUNCTIONS EXPORT
// ============================================================================

// For Google Cloud Functions (optional)
functions.http('api', app);

// Start server (Railway and local dev)
const PORT = process.env.PORT || 8080;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`REI API running on port ${PORT}`);
});

module.exports = { app };
