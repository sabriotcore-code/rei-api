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
    WORKFLOW_PROCESSOR: '1MBGcdzYKcE_5VVk07b1iwlhXN0JDqSWv4o-fG29Ie7E',
    NOTE_HISTORY: '1r4kwssjJNG1j7mpU6ktuVxIFfhTknO86XnNsVm2dQ-g'
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

// Parse #tagged users from note text
function parseTaggedUsers(noteText) {
  if (!noteText) return [];
  // Match #Name patterns (letters, numbers, @, ., -)
  const tagPattern = /#([a-zA-Z][a-zA-Z0-9@.\-]*)/g;
  const matches = noteText.match(tagPattern) || [];

  // Extract names, normalize, and deduplicate
  const tagged = [...new Set(
    matches.map(tag => {
      const name = tag.substring(1); // Remove #
      // Capitalize first letter for consistency
      return name.charAt(0).toUpperCase() + name.slice(1).toLowerCase();
    })
  )];

  return tagged;
}

// Detect who wrote the note (for future user detection)
function detectNoteAuthor(data) {
  // Check if author explicitly provided
  if (data.noteBy) return data.noteBy;
  if (data.author) return data.author;
  if (data.user) return data.user;

  // Check for email pattern
  if (data.email) {
    if (data.email.includes('matt')) return 'Matt';
    if (data.email.includes('erik')) return 'Erik';
    if (data.email.includes('jon')) return 'Jon';
    return data.email;
  }

  // Default to Matt for now
  return 'Matt';
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

  // Create a new to-do directly in TO_DO_MASTER
  queueTodo: async (data) => {
    if (!data.payload || !data.payload.action) {
      throw new Error('Payload with action is required');
    }

    const todoId = generateId('TD');
    const now = new Date();

    // Get TO_DO_MASTER headers to match column structure
    const rows = await getSheetData(CONFIG.SHEETS.PME, `${CONFIG.TABS.TO_DO_MASTER}!1:1`);
    if (!rows.length) throw new Error('Could not read TO_DO_MASTER headers');

    const headers = rows[0].map(normalizeHeader);
    const headerMap = {};
    headers.forEach((h, i) => {
      if (h) headerMap[h.toUpperCase().replace(/\s+/g, '_')] = i;
    });

    // Build row array matching TO_DO_MASTER structure
    const newRow = new Array(headers.length).fill('');

    // Helper to set column value
    const setCol = (colNames, value) => {
      const names = Array.isArray(colNames) ? colNames : [colNames];
      for (const colName of names) {
        const key = colName.toUpperCase().replace(/\s+/g, '_');
        if (headerMap[key] !== undefined) {
          newRow[headerMap[key]] = value;
          return;
        }
      }
    };

    // Set all fields
    setCol(['TO_DO_ID', 'TODO_ID'], todoId);
    setCol(['REID'], data.reid || '');
    setCol(['PRIMARY'], data.primary || '');
    setCol(['ACTION'], data.payload.action || '');
    setCol(['ASSIGNED_TO', 'WHO'], data.payload.who || 'Matt');
    setCol(['TO_DO_STATUS', 'STATUS'], 'OPEN');
    setCol(['CREATED_DATE/TIME', 'CREATED', 'CREATED_DATETIME'], now);
    setCol(['CREATED_BY', 'CREATEDBY'], 'Dashboard');
    setCol(['TRIGGER_TYPE'], 'MANUAL');
    setCol(['SOURCE_STATUS'], data.payload.sourceStatus || '');
    setCol(['DUE_DATE', 'DUEDATE'], data.payload.dueDate || '');
    setCol(['NOTES'], data.payload.notes || '');

    // Append directly to TO_DO_MASTER
    await appendRow(CONFIG.SHEETS.PME, `${CONFIG.TABS.TO_DO_MASTER}!A:Z`, newRow);

    return {
      success: true,
      todoId,
      message: 'To-do created successfully',
      timestamp: now.toISOString()
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

  // Create a note directly in NOTE_HISTORY
  // New schema: TIMESTAMP | REID | PRIMARY | NOTE_TEXT | NOTE_BY | TAGGED | TO_DO_CREATED | TO_DO_ID | SOURCE
  queueNote: async (data) => {
    if (!data.payload || !data.payload.note) {
      throw new Error('Payload with note is required');
    }

    const now = new Date();
    const noteId = generateId('NT');
    const noteText = data.payload.note;
    const source = data.source || 'Dashboard';

    // Format timestamp as readable string for Google Sheets
    const timestamp = now.toLocaleString('en-US', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
    });

    // Parse tagged users from note text
    const taggedUsers = parseTaggedUsers(noteText);
    const hasTagged = taggedUsers.length > 0;

    // Detect who wrote the note
    const noteBy = detectNoteAuthor(data);

    // If users are tagged, create to-dos for each
    const todoIds = [];
    if (hasTagged) {
      for (const assignee of taggedUsers) {
        const todoId = generateId('TD');
        todoIds.push(todoId);

        // Get TO_DO_MASTER headers
        const rows = await getSheetData(CONFIG.SHEETS.PME, `${CONFIG.TABS.TO_DO_MASTER}!1:1`);
        if (rows.length) {
          const headers = rows[0].map(normalizeHeader);
          const headerMap = {};
          headers.forEach((h, i) => {
            if (h) headerMap[h.toUpperCase().replace(/\s+/g, '_')] = i;
          });

          // Build row array matching TO_DO_MASTER structure
          const newRow = new Array(headers.length).fill('');

          const setCol = (colNames, value) => {
            const names = Array.isArray(colNames) ? colNames : [colNames];
            for (const colName of names) {
              const key = colName.toUpperCase().replace(/\s+/g, '_');
              if (headerMap[key] !== undefined) {
                newRow[headerMap[key]] = value;
                return;
              }
            }
          };

          // Set all fields for the to-do
          setCol(['TO_DO_ID', 'TODO_ID'], todoId);
          setCol(['REID'], data.reid || '');
          setCol(['PRIMARY'], data.primary || '');
          setCol(['ACTION'], noteText); // Use full note as action
          setCol(['ASSIGNED_TO', 'WHO'], assignee);
          setCol(['TO_DO_STATUS', 'STATUS'], 'OPEN');
          setCol(['CREATED_DATE/TIME', 'CREATED', 'CREATED_DATETIME'], timestamp);
          setCol(['CREATED_BY', 'CREATEDBY'], noteBy);
          setCol(['TRIGGER_TYPE'], 'NOTE_TAG');
          setCol(['SOURCE_STATUS'], '');
          setCol(['NOTES'], `Auto-created from note ${noteId}`);

          await appendRow(CONFIG.SHEETS.PME, `${CONFIG.TABS.TO_DO_MASTER}!A:Z`, newRow);
          console.log('To-do created from note tag:', { todoId, assignee, noteId });
        }
      }
    }

    // Write to NOTE_HISTORY with new schema
    // Columns: TIMESTAMP | REID | PRIMARY | NOTE_TEXT | NOTE_BY | TAGGED | TO_DO_CREATED | TO_DO_ID | SOURCE
    await appendRow(CONFIG.SHEETS.NOTE_HISTORY, 'NOTE_HISTORY!A:I', [
      timestamp,                          // A: TIMESTAMP
      data.reid || '',                    // B: REID
      data.primary || '',                 // C: PRIMARY
      noteText,                           // D: NOTE_TEXT
      noteBy,                             // E: NOTE_BY
      taggedUsers.join(', '),             // F: TAGGED (comma-separated)
      hasTagged ? 'TRUE' : 'FALSE',       // G: TO_DO_CREATED
      todoIds.join(', '),                 // H: TO_DO_ID (comma-separated if multiple)
      source                              // I: SOURCE
    ]);

    console.log('Note saved:', { noteId, reid: data.reid, tagged: taggedUsers, todoCreated: hasTagged });

    return {
      success: true,
      noteId,
      todoIds: todoIds.length > 0 ? todoIds : null,
      tagged: taggedUsers,
      message: hasTagged
        ? `Note saved & ${todoIds.length} to-do(s) created for: ${taggedUsers.join(', ')}`
        : 'Note saved successfully',
      timestamp: now.toISOString()
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
  },

  // Get note history for a property or all
  // New schema: TIMESTAMP | REID | PRIMARY | NOTE_TEXT | NOTE_BY | TAGGED | TO_DO_CREATED | TO_DO_ID | SOURCE
  getNoteHistory: async (data) => {
    const rows = await getSheetData(CONFIG.SHEETS.NOTE_HISTORY, 'NOTE_HISTORY!A:I');

    // Handle empty sheet or just headers
    if (rows.length < 1) {
      return { success: true, notes: [], count: 0 };
    }

    // Check if first row is headers or data
    const firstRow = rows[0];
    const hasHeaders = firstRow && firstRow[0] &&
      String(firstRow[0]).toUpperCase().includes('TIMESTAMP');

    let dataStartIdx = hasHeaders ? 1 : 0;

    // Build header map if headers exist
    const headerMap = {};
    if (hasHeaders) {
      const headers = firstRow.map(normalizeHeader);
      headers.forEach((h, i) => {
        if (h) headerMap[h.toUpperCase().replace(/\s+/g, '_')] = i;
      });
    }

    const notes = [];
    const reidFilter = data.reid ? data.reid : null;
    const limit = data.limit || 100;

    // Process from bottom (newest) to top (oldest)
    for (let i = rows.length - 1; i >= dataStartIdx && notes.length < limit; i--) {
      const row = rows[i];
      if (!row || row.length === 0) continue;

      // New column positions: A=TIMESTAMP, B=REID, C=PRIMARY, D=NOTE_TEXT, E=NOTE_BY, F=TAGGED, G=TO_DO_CREATED, H=TO_DO_ID, I=SOURCE
      const timestamp = row[headerMap['TIMESTAMP'] ?? 0] || '';
      const rowReid = row[headerMap['REID'] ?? 1] || '';
      const primary = row[headerMap['PRIMARY'] ?? 2] || '';
      const noteText = row[headerMap['NOTE_TEXT'] ?? headerMap['NOTE'] ?? 3] || '';
      const noteBy = row[headerMap['NOTE_BY'] ?? 4] || '';
      const tagged = row[headerMap['TAGGED'] ?? 5] || '';
      const todoCreated = row[headerMap['TO_DO_CREATED'] ?? 6] || '';
      const todoId = row[headerMap['TO_DO_ID'] ?? 7] || '';
      const source = row[headerMap['SOURCE'] ?? 8] || '';

      // Skip if no note content
      if (!noteText && !timestamp) continue;

      if (reidFilter && rowReid !== reidFilter) continue;

      notes.push({
        timestamp,
        reid: rowReid,
        primary,
        note: noteText,
        noteBy: noteBy || 'Unknown',
        tagged: tagged ? tagged.split(',').map(t => t.trim()) : [],
        todoCreated: todoCreated === 'TRUE',
        todoId,
        source: source || 'Dashboard'
      });
    }

    return {
      success: true,
      notes,
      count: notes.length,
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
