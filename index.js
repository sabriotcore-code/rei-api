/**
 * REI API - Cloud Functions Replacement for Apps Script
 *
 * MAJOR UPDATE: Property Detail Redesign
 * - New schema for NOTE_HISTORY
 * - Activity history combining notes, to-dos, messages
 * - Assignee management from VAR tab
 * - Message queueing with scheduling
 *
 * Endpoints:
 * - POST / with { action: 'ping' } - Health check
 * - POST / with { action: 'getTodos', filter: {} } - Get to-dos
 * - POST / with { action: 'queueTodo', reid, primary, payload } - Add to-do
 * - POST / with { action: 'updateTodo', todoId, updates } - Update to-do
 * - POST / with { action: 'completeTodo', todoId, completedBy } - Mark to-do done
 * - POST / with { action: 'queueNote', reid, primary, payload } - Add note (with optional linked to-do)
 * - POST / with { action: 'getAllPropertyLabels' } - Get all property data
 * - POST / with { action: 'getStatusConfig' } - Get status configuration
 * - POST / with { action: 'getActivityHistory', reid } - Get combined activity history
 * - POST / with { action: 'getAssignees' } - Get assignee list from VAR
 * - POST / with { action: 'getOpenTodos', reid } - Get open to-dos for a property
 * - POST / with { action: 'queueMessage', reid, payload } - Queue/send a message
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
    QUEUE: 'QUEUE',
    NOTE_HISTORY: 'NOTE_HISTORY',
    MESSAGE_LOG: 'MESSAGE_LOG'
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

function formatTimestamp(date = new Date()) {
  return date.toLocaleString('en-US', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
  });
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

async function updateRow(spreadsheetId, range, values) {
  const sheets = await getSheets();
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range,
    valueInputOption: 'USER_ENTERED',
    resource: { values: [values] }
  });
}

// Ensure sheet/tab exists, create headers if needed
async function ensureSheetHeaders(spreadsheetId, tabName, headers) {
  try {
    const rows = await getSheetData(spreadsheetId, `${tabName}!1:1`);
    if (!rows || rows.length === 0 || !rows[0] || rows[0].length === 0) {
      // No headers, write them
      await updateRow(spreadsheetId, `${tabName}!A1`, headers);
      console.log(`Created headers for ${tabName}`);
    }
  } catch (err) {
    // Tab might not exist - try to create it or just log
    console.log(`Note: Could not verify headers for ${tabName}:`, err.message);
  }
}

// ============================================================================
// API HANDLERS
// ============================================================================

const handlers = {
  // Health check
  ping: async () => {
    return { pong: true, timestamp: new Date().toISOString(), service: 'rei-api', version: '2.0.0' };
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

      const dueDate = row[headerMap['DUE_DATE']] || row[headerMap['DUEDATE']] || '';
      const createdDate = row[headerMap['CREATED_DATE/TIME']] || row[headerMap['CREATED']] || '';

      todos.push({
        rowIndex: i + 1,
        todoId: row[headerMap['TO_DO_ID']] || row[headerMap['TODO_ID']] || '',
        reid: row[headerMap['REID']] || '',
        primary: row[headerMap['PRIMARY']] || '',
        action: row[headerMap['ACTION']] || '',
        assignedTo: assignee,
        status: status,
        createdDate: createdDate,
        dueDate: dueDate,
        sourceStatus: row[headerMap['SOURCE_STATUS']] || '',
        linkedNoteId: row[headerMap['LINKED_NOTE_ID']] || '',
        completedAt: row[headerMap['COMPLETED_AT']] || '',
        completedBy: row[headerMap['COMPLETED_BY']] || ''
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

  // Get open to-dos for a specific property
  // filter: 'open' (default), 'future', 'completed', 'all'
  getOpenTodos: async (data) => {
    const { reid, filter = 'open' } = data;
    const rows = await getSheetData(CONFIG.SHEETS.PME, `${CONFIG.TABS.TO_DO_MASTER}!A:Z`);

    if (rows.length < 2) {
      return { success: true, todos: [], count: 0, openCount: 0, futureCount: 0, completedCount: 0 };
    }

    const headers = rows[0].map(normalizeHeader);
    const headerMap = {};
    headers.forEach((h, i) => { if (h) headerMap[h.toUpperCase().replace(/\s+/g, '_')] = i; });

    const allTodos = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const sevenDaysOut = new Date(today);
    sevenDaysOut.setDate(sevenDaysOut.getDate() + 7);

    // First pass: collect ALL todos for this property to get accurate counts
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const rowReid = row[headerMap['REID']] || '';

      // Filter by property if specified
      if (reid && rowReid !== reid) continue;

      const status = String(row[headerMap['TO_DO_STATUS']] || row[headerMap['STATUS']] || 'OPEN').toUpperCase();
      const isCompleted = status === 'DONE' || status === 'COMPLETED' || status === 'CLOSED';

      const dueDateStr = row[headerMap['DUE_DATE']] || row[headerMap['DUEDATE']] || '';
      let dueDate = null;
      let isFuture = false;

      if (dueDateStr) {
        dueDate = new Date(dueDateStr);
        if (!isNaN(dueDate.getTime())) {
          dueDate.setHours(0, 0, 0, 0);
          isFuture = dueDate > sevenDaysOut;
        }
      }

      const assignee = row[headerMap['ASSIGNED_TO']] || row[headerMap['WHO']] || 'Unassigned';
      const createdDate = row[headerMap['CREATED_DATE/TIME']] || row[headerMap['CREATED']] || '';

      // Determine category: open (active), future, or completed
      let category = 'open';
      if (isCompleted) {
        category = 'completed';
      } else if (isFuture) {
        category = 'future';
      }

      allTodos.push({
        rowIndex: i + 1,
        todoId: row[headerMap['TO_DO_ID']] || row[headerMap['TODO_ID']] || '',
        reid: rowReid,
        primary: row[headerMap['PRIMARY']] || '',
        action: row[headerMap['ACTION']] || '',
        assignedTo: assignee,
        status: status,
        createdDate: createdDate,
        dueDate: dueDateStr,
        category,
        isFuture,
        isCompleted,
        sourceStatus: row[headerMap['SOURCE_STATUS']] || '',
        linkedNoteId: row[headerMap['LINKED_NOTE_ID']] || '',
        completedAt: row[headerMap['COMPLETED_AT']] || '',
        completedBy: row[headerMap['COMPLETED_BY']] || '',
        createdBy: row[headerMap['CREATED_BY']] || row[headerMap['CREATEDBY']] || ''
      });
    }

    // Calculate counts from ALL todos
    const openCount = allTodos.filter(t => t.category === 'open').length;
    const futureCount = allTodos.filter(t => t.category === 'future').length;
    const completedCount = allTodos.filter(t => t.category === 'completed').length;

    // Filter based on selected filter
    let filteredTodos = allTodos;
    if (filter === 'open') {
      filteredTodos = allTodos.filter(t => t.category === 'open');
    } else if (filter === 'future') {
      filteredTodos = allTodos.filter(t => t.category === 'future');
    } else if (filter === 'completed') {
      filteredTodos = allTodos.filter(t => t.category === 'completed');
    }
    // 'all' returns everything

    // Sort: by due date for open/future, by completedAt for completed
    filteredTodos.sort((a, b) => {
      // Completed always last when showing all
      if (filter === 'all') {
        if (a.isCompleted && !b.isCompleted) return 1;
        if (!a.isCompleted && b.isCompleted) return -1;
      }

      // For completed, sort by completedAt (newest first)
      if (a.isCompleted && b.isCompleted) {
        const aDate = a.completedAt ? new Date(a.completedAt) : new Date(0);
        const bDate = b.completedAt ? new Date(b.completedAt) : new Date(0);
        return bDate - aDate;
      }

      // For open/future, sort by due date (soonest first, overdue at top)
      const aDate = a.dueDate ? new Date(a.dueDate) : new Date('2099-12-31');
      const bDate = b.dueDate ? new Date(b.dueDate) : new Date('2099-12-31');
      return aDate - bDate;
    });

    return {
      success: true,
      todos: filteredTodos,
      count: filteredTodos.length,
      openCount,
      futureCount,
      completedCount,
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
    const timestamp = formatTimestamp(now);

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
    setCol(['ASSIGNED_TO', 'WHO'], data.payload.who || data.payload.assignee || 'Matt');
    setCol(['TO_DO_STATUS', 'STATUS'], 'OPEN');
    setCol(['CREATED_DATE/TIME', 'CREATED', 'CREATED_DATETIME'], timestamp);
    setCol(['CREATED_BY', 'CREATEDBY'], data.payload.createdBy || 'Dashboard');
    setCol(['TRIGGER_TYPE'], data.payload.triggerType || 'MANUAL');
    setCol(['SOURCE_STATUS'], data.payload.sourceStatus || '');
    setCol(['DUE_DATE', 'DUEDATE'], data.payload.dueDate || '');
    setCol(['NOTES'], data.payload.notes || '');
    setCol(['LINKED_NOTE_ID'], data.payload.linkedNoteId || '');

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
        updateLog.push('status -> ' + updates.status);
      }
    }

    if (updates.assignee !== undefined) {
      const assigneeCol = headerMap['ASSIGNED_TO'] !== undefined ? headerMap['ASSIGNED_TO'] : headerMap['WHO'];
      if (assigneeCol !== undefined) {
        const colLetter = String.fromCharCode(65 + assigneeCol);
        await updateCell(CONFIG.SHEETS.PME, `${CONFIG.TABS.TO_DO_MASTER}!${colLetter}${targetRow}`, updates.assignee);
        updateLog.push('assignee -> ' + updates.assignee);
      }
    }

    if (updates.dueDate !== undefined) {
      const dueDateCol = headerMap['DUE_DATE'] !== undefined ? headerMap['DUE_DATE'] : headerMap['DUEDATE'];
      if (dueDateCol !== undefined) {
        const colLetter = String.fromCharCode(65 + dueDateCol);
        await updateCell(CONFIG.SHEETS.PME, `${CONFIG.TABS.TO_DO_MASTER}!${colLetter}${targetRow}`, updates.dueDate);
        updateLog.push('dueDate -> ' + updates.dueDate);
      }
    }

    return {
      success: true,
      todoId: data.todoId,
      updates: updateLog,
      timestamp: new Date().toISOString()
    };
  },

  // Complete a to-do (mark as DONE with completion metadata)
  completeTodo: async (data) => {
    if (!data.todoId) throw new Error('todoId is required');

    const rows = await getSheetData(CONFIG.SHEETS.PME, `${CONFIG.TABS.TO_DO_MASTER}!A:Z`);
    if (rows.length < 2) throw new Error('No to-dos found');

    const headers = rows[0].map(normalizeHeader);
    const headerMap = {};
    headers.forEach((h, i) => { if (h) headerMap[h.toUpperCase().replace(/\s+/g, '_')] = i; });

    const todoIdCol = headerMap['TO_DO_ID'] !== undefined ? headerMap['TO_DO_ID'] : headerMap['TODO_ID'];
    let targetRow = -1;
    let originalRow = null;

    for (let i = 1; i < rows.length; i++) {
      if (rows[i][todoIdCol] === data.todoId) {
        targetRow = i + 1;
        originalRow = rows[i];
        break;
      }
    }

    if (targetRow === -1) throw new Error('Todo not found: ' + data.todoId);

    const now = new Date();
    const timestamp = formatTimestamp(now);
    const completedBy = data.completedBy || 'Dashboard';
    const updateLog = [];

    // Update status to DONE
    const statusCol = headerMap['TO_DO_STATUS'] !== undefined ? headerMap['TO_DO_STATUS'] : headerMap['STATUS'];
    if (statusCol !== undefined) {
      const colLetter = String.fromCharCode(65 + statusCol);
      await updateCell(CONFIG.SHEETS.PME, `${CONFIG.TABS.TO_DO_MASTER}!${colLetter}${targetRow}`, 'DONE');
      updateLog.push('status -> DONE');
    }

    // Update COMPLETED_AT if column exists
    if (headerMap['COMPLETED_AT'] !== undefined) {
      const colLetter = String.fromCharCode(65 + headerMap['COMPLETED_AT']);
      await updateCell(CONFIG.SHEETS.PME, `${CONFIG.TABS.TO_DO_MASTER}!${colLetter}${targetRow}`, timestamp);
      updateLog.push('completedAt -> ' + timestamp);
    }

    // Update COMPLETED_BY if column exists
    if (headerMap['COMPLETED_BY'] !== undefined) {
      const colLetter = String.fromCharCode(65 + headerMap['COMPLETED_BY']);
      await updateCell(CONFIG.SHEETS.PME, `${CONFIG.TABS.TO_DO_MASTER}!${colLetter}${targetRow}`, completedBy);
      updateLog.push('completedBy -> ' + completedBy);
    }

    return {
      success: true,
      todoId: data.todoId,
      completedAt: timestamp,
      completedBy,
      updates: updateLog,
      timestamp: now.toISOString()
    };
  },

  // Create a note (with optional linked to-do)
  // New schema: TIMESTAMP | REID | PRIMARY | NOTE_TEXT | NOTE_BY | SOURCE | TO_DO_CREATED | TO_DO_ID
  queueNote: async (data) => {
    if (!data.payload || !data.payload.note) {
      throw new Error('Payload with note is required');
    }

    const now = new Date();
    const noteId = generateId('NT');
    const noteText = data.payload.note;
    const source = data.source || 'Dashboard';
    const timestamp = formatTimestamp(now);

    // Detect who wrote the note
    const noteBy = detectNoteAuthor(data);

    // Check if we should also create a to-do
    const createTodo = data.payload.createTodo === true;
    let todoId = null;

    if (createTodo) {
      todoId = generateId('TD');
      const assignee = data.payload.assignee || 'Matt';
      const dueDate = data.payload.dueDate || '';

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
        setCol(['ACTION'], noteText); // Use note text as action
        setCol(['ASSIGNED_TO', 'WHO'], assignee);
        setCol(['TO_DO_STATUS', 'STATUS'], 'OPEN');
        setCol(['CREATED_DATE/TIME', 'CREATED', 'CREATED_DATETIME'], timestamp);
        setCol(['CREATED_BY', 'CREATEDBY'], noteBy);
        setCol(['TRIGGER_TYPE'], 'NOTE_TODO');
        setCol(['SOURCE_STATUS'], '');
        setCol(['DUE_DATE', 'DUEDATE'], dueDate);
        setCol(['NOTES'], `Created from note ${noteId}`);
        setCol(['LINKED_NOTE_ID'], noteId);

        await appendRow(CONFIG.SHEETS.PME, `${CONFIG.TABS.TO_DO_MASTER}!A:Z`, newRow);
        console.log('To-do created from note:', { todoId, assignee, noteId });
      }
    }

    // Ensure NOTE_HISTORY has headers
    await ensureSheetHeaders(CONFIG.SHEETS.NOTE_HISTORY, CONFIG.TABS.NOTE_HISTORY,
      ['TIMESTAMP', 'REID', 'PRIMARY', 'NOTE_TEXT', 'NOTE_BY', 'SOURCE', 'TO_DO_CREATED', 'TO_DO_ID']);

    // Write to NOTE_HISTORY with new schema
    // Columns: TIMESTAMP | REID | PRIMARY | NOTE_TEXT | NOTE_BY | SOURCE | TO_DO_CREATED | TO_DO_ID
    await appendRow(CONFIG.SHEETS.NOTE_HISTORY, `${CONFIG.TABS.NOTE_HISTORY}!A:H`, [
      timestamp,                          // A: TIMESTAMP
      data.reid || '',                    // B: REID
      data.primary || '',                 // C: PRIMARY
      noteText,                           // D: NOTE_TEXT
      noteBy,                             // E: NOTE_BY
      source,                             // F: SOURCE
      createTodo ? 'TRUE' : 'FALSE',      // G: TO_DO_CREATED
      todoId || ''                        // H: TO_DO_ID
    ]);

    console.log('Note saved:', { noteId, reid: data.reid, todoCreated: createTodo, todoId });

    return {
      success: true,
      noteId,
      todoId: todoId,
      todoCreated: createTodo,
      message: createTodo
        ? `Note saved & to-do created`
        : 'Note saved successfully',
      timestamp: now.toISOString()
    };
  },

  // Get combined activity history for a property (notes + to-do events + messages)
  getActivityHistory: async (data) => {
    const { reid, limit = 50 } = data;
    const activities = [];
    const now = new Date();

    // 1. Get Notes
    try {
      const noteRows = await getSheetData(CONFIG.SHEETS.NOTE_HISTORY, `${CONFIG.TABS.NOTE_HISTORY}!A:H`);
      if (noteRows.length > 0) {
        const hasHeaders = noteRows[0] && String(noteRows[0][0] || '').toUpperCase().includes('TIMESTAMP');
        const startIdx = hasHeaders ? 1 : 0;

        for (let i = startIdx; i < noteRows.length; i++) {
          const row = noteRows[i];
          if (!row || row.length === 0) continue;

          const rowReid = row[1] || ''; // B: REID
          if (reid && rowReid !== reid) continue;

          activities.push({
            type: 'note',
            timestamp: row[0] || '',       // A: TIMESTAMP
            reid: rowReid,
            primary: row[2] || '',          // C: PRIMARY
            content: row[3] || '',          // D: NOTE_TEXT
            actor: row[4] || 'Unknown',     // E: NOTE_BY
            source: row[5] || 'Dashboard',  // F: SOURCE
            todoCreated: row[6] === 'TRUE', // G: TO_DO_CREATED
            linkedTodoId: row[7] || ''      // H: TO_DO_ID
          });
        }
      }
    } catch (err) {
      console.log('Error reading notes:', err.message);
    }

    // 2. Get To-Do events (created and completed)
    try {
      const todoRows = await getSheetData(CONFIG.SHEETS.PME, `${CONFIG.TABS.TO_DO_MASTER}!A:Z`);
      if (todoRows.length > 1) {
        const headers = todoRows[0].map(normalizeHeader);
        const headerMap = {};
        headers.forEach((h, i) => { if (h) headerMap[h.toUpperCase().replace(/\s+/g, '_')] = i; });

        for (let i = 1; i < todoRows.length; i++) {
          const row = todoRows[i];
          const rowReid = row[headerMap['REID']] || '';
          if (reid && rowReid !== reid) continue;

          const todoId = row[headerMap['TO_DO_ID']] || row[headerMap['TODO_ID']] || '';
          const action = row[headerMap['ACTION']] || '';
          const assignee = row[headerMap['ASSIGNED_TO']] || row[headerMap['WHO']] || 'Unassigned';
          const status = String(row[headerMap['TO_DO_STATUS']] || row[headerMap['STATUS']] || 'OPEN').toUpperCase();
          const createdDate = row[headerMap['CREATED_DATE/TIME']] || row[headerMap['CREATED']] || '';
          const createdBy = row[headerMap['CREATED_BY']] || row[headerMap['CREATEDBY']] || 'System';
          const completedAt = row[headerMap['COMPLETED_AT']] || '';
          const completedBy = row[headerMap['COMPLETED_BY']] || '';
          const linkedNoteId = row[headerMap['LINKED_NOTE_ID']] || '';

          // Add "created" event (but skip if it was created from a note - that's already in notes)
          if (createdDate && !linkedNoteId) {
            activities.push({
              type: 'todo_created',
              timestamp: createdDate,
              reid: rowReid,
              content: action,
              actor: createdBy,
              assignee: assignee,
              todoId: todoId
            });
          }

          // Add "completed" event if completed
          if (completedAt && (status === 'DONE' || status === 'COMPLETED' || status === 'CLOSED')) {
            activities.push({
              type: 'todo_completed',
              timestamp: completedAt,
              reid: rowReid,
              content: action,
              actor: completedBy || 'Unknown',
              assignee: assignee,
              todoId: todoId
            });
          }
        }
      }
    } catch (err) {
      console.log('Error reading to-dos:', err.message);
    }

    // 3. Get Messages (if MESSAGE_LOG exists) - FILTER OUT FUTURE SCHEDULED
    try {
      const msgRows = await getSheetData(CONFIG.SHEETS.NOTE_HISTORY, `${CONFIG.TABS.MESSAGE_LOG}!A:I`);
      if (msgRows.length > 0) {
        const hasHeaders = msgRows[0] && String(msgRows[0][0] || '').toUpperCase().includes('MESSAGE');
        const startIdx = hasHeaders ? 1 : 0;

        for (let i = startIdx; i < msgRows.length; i++) {
          const row = msgRows[i];
          if (!row || row.length === 0) continue;

          const rowReid = row[2] || ''; // C: REID
          if (reid && rowReid !== reid) continue;

          const msgStatus = row[7] || '';       // H: STATUS
          const scheduledDate = row[6] || '';   // G: SCHEDULED_DATE

          // FILTER OUT: Messages with SCHEDULED status and future scheduledDate
          if (msgStatus === 'SCHEDULED' && scheduledDate) {
            const schedDate = new Date(scheduledDate);
            if (!isNaN(schedDate.getTime()) && schedDate > now) {
              // Future scheduled message - don't show in history
              continue;
            }
          }

          activities.push({
            type: 'message',
            messageId: row[0] || '',        // A: MESSAGE_ID
            timestamp: row[1] || '',        // B: TIMESTAMP
            reid: rowReid,
            recipients: row[3] || '',       // D: RECIPIENTS
            channel: row[4] || '',          // E: CHANNEL
            content: row[5] || '',          // F: CONTENT
            scheduledDate: scheduledDate,
            status: msgStatus,
            actor: row[8] || 'System'       // I: SENT_BY
          });
        }
      }
    } catch (err) {
      // MESSAGE_LOG might not exist yet - that's OK
      console.log('Note: MESSAGE_LOG not available:', err.message);
    }

    // Sort by timestamp (newest first)
    activities.sort((a, b) => {
      const dateA = new Date(a.timestamp);
      const dateB = new Date(b.timestamp);
      if (isNaN(dateA.getTime())) return 1;
      if (isNaN(dateB.getTime())) return -1;
      return dateB - dateA;
    });

    return {
      success: true,
      activities: activities.slice(0, limit),
      count: activities.length,
      timestamp: new Date().toISOString()
    };
  },

  // Get assignees from VAR tab
  getAssignees: async () => {
    const rows = await getSheetData(CONFIG.SHEETS.PME, `${CONFIG.TABS.VAR}!A:Z`);

    if (rows.length < 1) {
      return { success: true, assignees: ['Matt', 'Erik', 'Jon', 'Patti'] }; // Defaults
    }

    const headers = rows[0].map(normalizeHeader);
    const headerMap = {};
    headers.forEach((h, i) => { if (h) headerMap[h.toUpperCase().replace(/\s+/g, '_')] = i; });

    // Look for assignee-related columns
    const assigneeColumns = [];
    const possibleNames = ['ASSIGNEE', 'WHO', 'TEAM', 'USER', 'PERSON', 'STAFF'];

    Object.keys(headerMap).forEach(key => {
      if (possibleNames.some(name => key.includes(name))) {
        assigneeColumns.push(headerMap[key]);
      }
    });

    // Also check columns K through O (indexes 10-14) as mentioned
    for (let col = 10; col <= 14; col++) {
      if (headers[col] && !assigneeColumns.includes(col)) {
        assigneeColumns.push(col);
      }
    }

    const assignees = new Set();

    // Get unique values from assignee columns
    for (let i = 1; i < rows.length; i++) {
      for (const col of assigneeColumns) {
        const value = rows[i][col];
        if (value && String(value).trim()) {
          assignees.add(String(value).trim());
        }
      }
    }

    // If no assignees found, use defaults
    if (assignees.size === 0) {
      return { success: true, assignees: ['Matt', 'Erik', 'Jon', 'Patti'] };
    }

    return {
      success: true,
      assignees: Array.from(assignees).sort(),
      timestamp: new Date().toISOString()
    };
  },

  // Queue/send a message
  queueMessage: async (data) => {
    if (!data.payload || !data.payload.content) {
      throw new Error('Payload with content is required');
    }

    const now = new Date();
    const messageId = generateId('MSG');
    const timestamp = formatTimestamp(now);

    const { content, recipients, channel, scheduledDate, sentBy } = data.payload;
    const status = scheduledDate ? 'SCHEDULED' : 'QUEUED';

    // Ensure MESSAGE_LOG has headers
    await ensureSheetHeaders(CONFIG.SHEETS.NOTE_HISTORY, CONFIG.TABS.MESSAGE_LOG,
      ['MESSAGE_ID', 'TIMESTAMP', 'REID', 'RECIPIENTS', 'CHANNEL', 'CONTENT', 'SCHEDULED_DATE', 'STATUS', 'SENT_BY']);

    // Write to MESSAGE_LOG
    await appendRow(CONFIG.SHEETS.NOTE_HISTORY, `${CONFIG.TABS.MESSAGE_LOG}!A:I`, [
      messageId,                              // A: MESSAGE_ID
      timestamp,                              // B: TIMESTAMP
      data.reid || '',                        // C: REID
      recipients || '',                       // D: RECIPIENTS (comma-separated: P1,P2,E)
      channel || 'SMS',                       // E: CHANNEL
      content,                                // F: CONTENT
      scheduledDate || '',                    // G: SCHEDULED_DATE
      status,                                 // H: STATUS
      sentBy || 'Dashboard'                   // I: SENT_BY
    ]);

    console.log('Message queued:', { messageId, reid: data.reid, channel, status });

    return {
      success: true,
      messageId,
      status,
      message: scheduledDate ? `Message scheduled for ${scheduledDate}` : 'Message queued',
      timestamp: now.toISOString()
    };
  },

  // Get note history for a property
  getNoteHistory: async (data) => {
    const rows = await getSheetData(CONFIG.SHEETS.NOTE_HISTORY, `${CONFIG.TABS.NOTE_HISTORY}!A:H`);

    // Handle empty sheet or just headers
    if (rows.length < 1) {
      return { success: true, notes: [], count: 0 };
    }

    // Check if first row is headers or data
    const firstRow = rows[0];
    const hasHeaders = firstRow && firstRow[0] &&
      String(firstRow[0]).toUpperCase().includes('TIMESTAMP');

    let dataStartIdx = hasHeaders ? 1 : 0;

    const notes = [];
    const reidFilter = data.reid ? data.reid : null;
    const limit = data.limit || 100;

    // Process from bottom (newest) to top (oldest)
    for (let i = rows.length - 1; i >= dataStartIdx && notes.length < limit; i--) {
      const row = rows[i];
      if (!row || row.length === 0) continue;

      // New column positions: A=TIMESTAMP, B=REID, C=PRIMARY, D=NOTE_TEXT, E=NOTE_BY, F=SOURCE, G=TO_DO_CREATED, H=TO_DO_ID
      const timestamp = row[0] || '';
      const rowReid = row[1] || '';
      const primary = row[2] || '';
      const noteText = row[3] || '';
      const noteBy = row[4] || '';
      const source = row[5] || '';
      const todoCreated = row[6] || '';
      const todoId = row[7] || '';

      // Skip if no note content
      if (!noteText && !timestamp) continue;

      if (reidFilter && rowReid !== reidFilter) continue;

      notes.push({
        timestamp,
        reid: rowReid,
        primary,
        note: noteText,
        noteBy: noteBy || 'Unknown',
        source: source || 'Dashboard',
        todoCreated: todoCreated === 'TRUE',
        todoId
      });
    }

    return {
      success: true,
      notes,
      count: notes.length,
      timestamp: new Date().toISOString()
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
    version: '2.0.0',
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
  console.log(`REI API v2.0.0 running on port ${PORT}`);
});

module.exports = { app };
