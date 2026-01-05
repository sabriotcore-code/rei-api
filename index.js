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
 * - POST / with { action: 'uploadToDrive', folderId, fileName, mimeType, content } - Upload file to Drive
 * - POST / with { action: 'sendSms', to, content, reid } - Send SMS via Quo (disabled)
 * - POST / with { action: 'getSmsConfig' } - Get Quo SMS configuration status
 * - POST / with { action: 'sendEmail', to, subject, body, reid } - Send email via Gmail
 * - POST / with { action: 'getEmailConfig' } - Get Gmail configuration status
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
    NOTE_HISTORY: '1r4kwssjJNG1j7mpU6ktuVxIFfhTknO86XnNsVm2dQ-g',
    PRODUCTION_SYNC: '1OkdwRL0eO2YKbVOJ9P0Z4ANGrKbyiBSJoRHFK0iVwrI'
  },
  TABS: {
    MAIN: 'MAIN',
    TO_DO_MASTER: 'TO_DO_MASTER',
    VAR: 'VAR',
    QUEUE: 'QUEUE',
    NOTE_HISTORY: 'NOTE_HISTORY',
    MESSAGE_LOG: 'MESSAGE_LOG',
    FEEDBACK: 'FEEDBACK'
  }
};

// ============================================================================
// PME DATA CACHE (5-minute refresh)
// ============================================================================

const pmeCache = {
  mainData: null,
  headers: null,
  headerMap: null,
  aggregates: null,
  lastRefresh: null,
  TTL_MS: 5 * 60 * 1000  // 5 minutes
};

function isCacheValid() {
  return pmeCache.mainData && pmeCache.lastRefresh &&
         (Date.now() - pmeCache.lastRefresh < pmeCache.TTL_MS);
}

async function refreshPMECache() {
  console.log('Refreshing PME cache...');
  const startTime = Date.now();

  try {
    const sheets = await getSheets();
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: CONFIG.SHEETS.PME,
      range: `${CONFIG.TABS.MAIN}!A:ZZ`
    });

    const rows = response.data.values || [];
    if (rows.length < 2) {
      console.log('PME cache: No data found');
      return;
    }

    // Process headers
    const headers = rows[0].map(h => h ? String(h).replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim() : '');
    const headerMap = {};
    headers.forEach((h, i) => {
      if (h) headerMap[h.toUpperCase().replace(/\s+/g, '_')] = i;
    });

    // Calculate aggregates
    const aggregates = calculateAggregates(rows, headerMap);

    // Store in cache
    pmeCache.mainData = rows;
    pmeCache.headers = headers;
    pmeCache.headerMap = headerMap;
    pmeCache.aggregates = aggregates;
    pmeCache.lastRefresh = Date.now();

    console.log(`PME cache refreshed in ${Date.now() - startTime}ms (${rows.length} rows, ${Object.keys(aggregates).length} aggregates)`);
  } catch (err) {
    console.error('PME cache refresh error:', err.message);
  }
}

function calculateAggregates(rows, headerMap) {
  const aggregates = {
    propertyCount: rows.length - 1,
    grossRcptsTotal: 0,
    grossRcptsCount: 0,
    rentTotal: 0,
    rentCount: 0,
    loanTotal: 0,
    taxTotal: 0,
    statusCounts: {},
    cityStats: {},
    entityStats: {}
  };

  // Column mappings
  const grossRcptsCol = headerMap['GROSS_RCPTS'] || headerMap['GROSS_RECEIPTS'] || headerMap['GROSSRCPTS'];
  const rentCol = headerMap['RENT'] || headerMap['CURRENT_RENT'] || headerMap['MONTHLY_RENT'];
  const loanCol = headerMap['LOAN_BALANCE'] || headerMap['LOAN'] || headerMap['LOAN_BAL'];
  const taxCol = headerMap['TAX'] || headerMap['PROPERTY_TAX'] || headerMap['TAXES'];
  const statusCol = headerMap['STATUS'];
  const cityCol = headerMap['CITY'];
  const entityCol = headerMap['ENTITY'] || headerMap['OWNER'] || headerMap['OWNERSHIP'];

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];

    // GROSS RCPTS
    if (grossRcptsCol !== undefined) {
      const val = parseFloat(String(row[grossRcptsCol] || '0').replace(/[,$]/g, ''));
      if (!isNaN(val)) {
        aggregates.grossRcptsTotal += val;
        if (val > 0) aggregates.grossRcptsCount++;
      }
    }

    // RENT
    if (rentCol !== undefined) {
      const val = parseFloat(String(row[rentCol] || '0').replace(/[,$]/g, ''));
      if (!isNaN(val)) {
        aggregates.rentTotal += val;
        if (val > 0) aggregates.rentCount++;
      }
    }

    // LOAN
    if (loanCol !== undefined) {
      const val = parseFloat(String(row[loanCol] || '0').replace(/[,$]/g, ''));
      if (!isNaN(val)) aggregates.loanTotal += val;
    }

    // TAX
    if (taxCol !== undefined) {
      const val = parseFloat(String(row[taxCol] || '0').replace(/[,$]/g, ''));
      if (!isNaN(val)) aggregates.taxTotal += val;
    }

    // STATUS counts
    if (statusCol !== undefined) {
      const status = String(row[statusCol] || 'Unknown').trim();
      aggregates.statusCounts[status] = (aggregates.statusCounts[status] || 0) + 1;
    }

    // CITY stats
    if (cityCol !== undefined) {
      const city = String(row[cityCol] || 'Unknown').trim();
      aggregates.cityStats[city] = (aggregates.cityStats[city] || 0) + 1;
    }

    // ENTITY stats
    if (entityCol !== undefined) {
      const entity = String(row[entityCol] || 'Unknown').trim();
      aggregates.entityStats[entity] = (aggregates.entityStats[entity] || 0) + 1;
    }
  }

  return aggregates;
}

// Auto-refresh cache on startup and every 5 minutes
setInterval(() => {
  refreshPMECache().catch(err => console.error('Cache auto-refresh failed:', err.message));
}, 5 * 60 * 1000);

// Auto-run production sync every 30 minutes
setInterval(() => {
  console.log('Auto-trigger: Running production sync...');
  runProductionSync(false)
    .then(result => {
      if (result.skipped) {
        console.log('Auto-sync skipped (no B1 change)');
      } else if (result.success) {
        console.log('Auto-sync completed:', result);
      } else {
        console.error('Auto-sync failed:', result.error);
      }
    })
    .catch(err => console.error('Auto-sync error:', err.message));
}, 30 * 60 * 1000); // 30 minutes

// ============================================================================
// PRODUCTION SYNC CACHE (tracks last B1 value)
// ============================================================================

const productionSyncCache = {
  lastB1Value: null,
  lastSyncTime: null
};

/**
 * Run production sync - copies data from external sheets to REI_PRODUCTION/ULTRA_PRODUCTION
 */
async function runProductionSync(force = false) {
  console.log('=== Starting production sync ===');
  const sheets = await getSheets();

  try {
    // Get VAR!B1 value
    const varResponse = await sheets.spreadsheets.values.get({
      spreadsheetId: CONFIG.SHEETS.PRODUCTION_SYNC,
      range: 'VAR!B1'
    });

    const currentB1 = varResponse.data.values?.[0]?.[0] || '';
    const currentB1Str = currentB1 ? String(currentB1) : '';

    console.log('Current VAR!B1:', currentB1Str);
    console.log('Last B1 value:', productionSyncCache.lastB1Value);

    // Check if B1 changed (skip if same unless forced)
    if (!force && currentB1Str === productionSyncCache.lastB1Value) {
      console.log('VAR!B1 unchanged, skipping sync');
      return {
        success: true,
        skipped: true,
        reason: 'No change in VAR!B1',
        lastValue: currentB1Str
      };
    }

    // Parse target date
    let targetDate;
    if (currentB1 instanceof Date) {
      targetDate = currentB1;
    } else {
      targetDate = new Date(currentB1);
    }

    if (isNaN(targetDate.getTime())) {
      return { success: false, error: 'Invalid date in VAR!B1: ' + currentB1Str };
    }

    console.log('Target date:', targetDate.toISOString());

    // Process both tabs
    const reiResult = await syncProductionTab(sheets, 'REI', 'REI_PRODUCTION', targetDate);
    const ultraResult = await syncProductionTab(sheets, 'ULTRA', 'ULTRA_PRODUCTION', targetDate);

    // Update cache
    productionSyncCache.lastB1Value = currentB1Str;
    productionSyncCache.lastSyncTime = new Date().toISOString();

    console.log('=== Production sync completed ===');

    return {
      success: true,
      targetDate: targetDate.toISOString(),
      rei: reiResult,
      ultra: ultraResult,
      timestamp: productionSyncCache.lastSyncTime
    };

  } catch (error) {
    console.error('Production sync error:', error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Sync a single tab pair (source -> production)
 */
async function syncProductionTab(sheets, sourceTabName, targetTabName, targetDate) {
  try {
    console.log(`Processing ${sourceTabName} -> ${targetTabName}`);

    // Get source tab data (column A has timestamps, column F has URLs)
    const sourceResponse = await sheets.spreadsheets.values.get({
      spreadsheetId: CONFIG.SHEETS.PRODUCTION_SYNC,
      range: `${sourceTabName}!A:F`
    });

    const rows = sourceResponse.data.values || [];
    if (rows.length < 2) {
      return { success: false, error: `No data in ${sourceTabName}` };
    }

    // Find latest row matching target date
    const targetDateOnly = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate());
    let latestRow = null;
    let latestTimestamp = null;

    for (let i = 1; i < rows.length; i++) {
      const cellValue = rows[i][0]; // Column A - timestamp
      if (!cellValue) continue;

      const cellDate = new Date(cellValue);
      if (isNaN(cellDate.getTime())) continue;

      const cellDateOnly = new Date(cellDate.getFullYear(), cellDate.getMonth(), cellDate.getDate());

      if (cellDateOnly.getTime() === targetDateOnly.getTime()) {
        if (!latestTimestamp || cellDate > latestTimestamp) {
          latestRow = i;
          latestTimestamp = cellDate;
        }
      }
    }

    if (latestRow === null) {
      console.log(`No matching date in ${sourceTabName}`);
      return { success: false, error: 'No matching date found' };
    }

    // Get URL from column F (index 5)
    const url = rows[latestRow][5];
    if (!url) {
      return { success: false, error: `No URL in row ${latestRow + 1}` };
    }

    console.log(`Found URL in row ${latestRow + 1}: ${url}`);

    // Extract sheet ID from URL
    const match = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    if (!match) {
      return { success: false, error: 'Invalid URL format: ' + url };
    }

    const externalSheetId = match[1];

    // Copy data from external sheet
    const externalResponse = await sheets.spreadsheets.values.get({
      spreadsheetId: externalSheetId,
      range: 'A:ZZ' // Get all data
    });

    const externalData = externalResponse.data.values || [];
    if (externalData.length === 0) {
      return { success: false, error: 'External sheet is empty' };
    }

    console.log(`Copying ${externalData.length} rows from external sheet`);

    // Clear target sheet and paste data
    await sheets.spreadsheets.values.clear({
      spreadsheetId: CONFIG.SHEETS.PRODUCTION_SYNC,
      range: `${targetTabName}!A:ZZ`
    });

    await sheets.spreadsheets.values.update({
      spreadsheetId: CONFIG.SHEETS.PRODUCTION_SYNC,
      range: `${targetTabName}!A1`,
      valueInputOption: 'USER_ENTERED',
      resource: { values: externalData }
    });

    console.log(`SUCCESS: Pasted ${externalData.length} rows to ${targetTabName}`);

    return {
      success: true,
      rowsCopied: externalData.length,
      sourceRow: latestRow + 1,
      externalSheetId
    };

  } catch (error) {
    console.error(`Error in ${sourceTabName}:`, error.message);
    return { success: false, error: error.message };
  }
}

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

// Create a new tab/sheet if it doesn't exist
async function createTabIfNotExists(spreadsheetId, tabName) {
  const sheets = await getSheets();
  try {
    // First check if tab exists by getting spreadsheet metadata
    const meta = await sheets.spreadsheets.get({ spreadsheetId });
    const exists = meta.data.sheets.some(s => s.properties.title === tabName);

    if (!exists) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        resource: {
          requests: [{
            addSheet: {
              properties: { title: tabName }
            }
          }]
        }
      });
      console.log(`Created new tab: ${tabName}`);
      return true;
    }
    return false;
  } catch (err) {
    console.log(`Error checking/creating tab ${tabName}:`, err.message);
    throw err;
  }
}

// Ensure sheet/tab exists, create headers if needed
async function ensureSheetHeaders(spreadsheetId, tabName, headers) {
  try {
    // First ensure the tab exists
    await createTabIfNotExists(spreadsheetId, tabName);

    // Now check/create headers
    const rows = await getSheetData(spreadsheetId, `${tabName}!1:1`);
    if (!rows || rows.length === 0 || !rows[0] || rows[0].length === 0) {
      // No headers, write them
      await updateRow(spreadsheetId, `${tabName}!A1`, headers);
      console.log(`Created headers for ${tabName}`);
    }
  } catch (err) {
    console.log(`Note: Could not verify headers for ${tabName}:`, err.message);
    throw err; // Re-throw so caller knows it failed
  }
}

// ============================================================================
// API HANDLERS
// ============================================================================

const handlers = {
  // Health check
  ping: async () => {
    return { pong: true, timestamp: new Date().toISOString(), service: 'rei-api', version: '2.2.0' };
  },

  // Production sync - runs on demand or via cron
  runProductionSync: async (data) => {
    const force = data.force === true;
    return await runProductionSync(force);
  },

  // Get production sync status
  getProductionSyncStatus: async () => {
    return {
      success: true,
      lastB1Value: productionSyncCache.lastB1Value,
      lastSyncTime: productionSyncCache.lastSyncTime,
      sheetId: CONFIG.SHEETS.PRODUCTION_SYNC,
      timestamp: new Date().toISOString()
    };
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

    // Normalize assignee name (handles #MATT, emails, etc.)
    const normalizeAssignee = (name) => {
      if (!name || typeof name !== 'string') return 'Other';
      let clean = name.replace(/^#/, '').trim();
      clean = clean.charAt(0).toUpperCase() + clean.slice(1).toLowerCase();
      const valid = ['Matt', 'Erik', 'Jon', 'Patti'];
      return valid.includes(clean) ? clean : 'Other';
    };

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const status = String(row[headerMap['TO_DO_STATUS']] || row[headerMap['STATUS']] || 'OPEN').toUpperCase();
      const rawAssignee = row[headerMap['ASSIGNED_TO']] || row[headerMap['WHO']] || '';
      const assignee = normalizeAssignee(rawAssignee);

      // Count stats by normalized assignee
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

    // Sort by createdDate descending (newest first) so new to-dos appear
    todos.sort((a, b) => {
      const dateA = new Date(a.createdDate || 0);
      const dateB = new Date(b.createdDate || 0);
      return dateB - dateA;
    });

    return {
      success: true,
      todos: todos.slice(0, filter.limit || 500),
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

      // Normalize assignee name (handles #MATT, emails, etc.)
      const normalizeAssignee = (name) => {
        if (!name || typeof name !== 'string') return 'Other';
        let clean = name.replace(/^#/, '').trim();
        clean = clean.charAt(0).toUpperCase() + clean.slice(1).toLowerCase();
        const valid = ['Matt', 'Erik', 'Jon', 'Patti'];
        return valid.includes(clean) ? clean : 'Other';
      };

      const rawAssignee = row[headerMap['ASSIGNED_TO']] || row[headerMap['WHO']] || '';
      const assignee = normalizeAssignee(rawAssignee);
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
          // Normalize assignee name
          const normalizeAssignee = (name) => {
            if (!name || typeof name !== 'string') return 'Other';
            let clean = name.replace(/^#/, '').trim();
            clean = clean.charAt(0).toUpperCase() + clean.slice(1).toLowerCase();
            const valid = ['Matt', 'Erik', 'Jon', 'Patti'];
            return valid.includes(clean) ? clean : 'Other';
          };
          const rawAssignee = row[headerMap['ASSIGNED_TO']] || row[headerMap['WHO']] || '';
          const assignee = normalizeAssignee(rawAssignee);
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

  // Get assignees - hardcoded list (VAR tab has polluted data)
  getAssignees: async () => {
    // Valid assignees only - sheet data is polluted with emails, #tags, TRUE, etc.
    return {
      success: true,
      assignees: ['Matt', 'Erik', 'Jon', 'Patti'],
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
  },

  // Upload file to Google Drive folder
  uploadToDrive: async (data) => {
    const { folderId, fileName, mimeType, content, reid } = data;

    if (!folderId) throw new Error('folderId is required');
    if (!fileName) throw new Error('fileName is required');
    if (!content) throw new Error('content (base64) is required');

    const auth = await getAuth();
    const drive = google.drive({ version: 'v3', auth });

    // Convert base64 to buffer
    const buffer = Buffer.from(content, 'base64');

    // Create file in Drive
    const fileMetadata = {
      name: fileName,
      parents: [folderId]
    };

    const media = {
      mimeType: mimeType || 'application/octet-stream',
      body: require('stream').Readable.from(buffer)
    };

    const response = await drive.files.create({
      requestBody: fileMetadata,
      media: media,
      fields: 'id, name, webViewLink'
    });

    console.log('File uploaded to Drive:', {
      fileId: response.data.id,
      fileName: response.data.name,
      folderId,
      reid
    });

    return {
      success: true,
      fileId: response.data.id,
      fileName: response.data.name,
      webViewLink: response.data.webViewLink,
      timestamp: new Date().toISOString()
    };
  },

  // ============================================================================
  // QUO SMS MESSAGING (Structure only - sending disabled)
  // ============================================================================

  // Send SMS via Quo API
  sendSms: async (data) => {
    const { to, content, from, reid } = data;

    if (!to) throw new Error('to (phone number) is required');
    if (!content) throw new Error('content (message text) is required');

    // Validate E.164 format
    const phoneRegex = /^\+1\d{10}$/;
    if (!phoneRegex.test(to)) {
      throw new Error('Phone number must be in E.164 format (e.g., +15016729023)');
    }

    // SMS sending enabled - requires manual click in dashboard
    const SMS_SENDING_ENABLED = true;

    // Quo PhoneNumberIds (use env var or default to Main Line)
    const QUO_PHONE_IDS = {
      'main': 'PNAANanpRa',      // (501) 222-4394 - Main Line
      'management': 'PNRvk9ByeI', // (501) 291-3308 - Management 2
      'collections': 'PNMXrjAEec', // (501) 913-9995 - COLLECTIONS
      'marketing': 'PNpndIvXHT',  // (501) 777-5502 - Marketing
      'acquisitions': 'PN3z5OO3wv' // (501) 271-3211 - Acquisitions
    };
    const defaultFromId = process.env.QUO_FROM_ID || QUO_PHONE_IDS.management;

    if (SMS_SENDING_ENABLED) {
      // Quo API call - requires PhoneNumberId (PNxxxx format)
      const fromId = from && from.startsWith('PN') ? from : defaultFromId;

      const quoResponse = await fetch('https://api.openphone.com/v1/messages', {
        method: 'POST',
        headers: {
          'Authorization': process.env.QUO_API_KEY,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          content: content,
          from: fromId,
          to: [to]
        })
      });

      if (!quoResponse.ok) {
        const error = await quoResponse.text();
        throw new Error('Quo API error: ' + error);
      }

      const result = await quoResponse.json();

      // Log sent SMS to MESSAGE_LOG
      await ensureSheetHeaders(CONFIG.SHEETS.NOTE_HISTORY, CONFIG.TABS.MESSAGE_LOG,
        ['MESSAGE_ID', 'TIMESTAMP', 'REID', 'RECIPIENTS', 'CHANNEL', 'CONTENT', 'SCHEDULED_DATE', 'STATUS', 'SENT_BY']);
      await appendRow(CONFIG.SHEETS.NOTE_HISTORY, `${CONFIG.TABS.MESSAGE_LOG}!A:I`, [
        result.data?.id || generateId('SMS'),
        formatTimestamp(new Date()),
        reid || '',
        to,
        'SMS',
        content,
        '',
        'SENT',
        'Dashboard'
      ]);

      return {
        success: true,
        sent: true,
        messageId: result.data?.id,
        status: 'sent',
        from: fromId,
        to,
        timestamp: new Date().toISOString()
      };
    }

    // Log the message that would be sent (for testing)
    console.log('SMS QUEUED (sending disabled):', { to, content, from, reid });

    // Write to MESSAGE_LOG for tracking
    await ensureSheetHeaders(CONFIG.SHEETS.NOTE_HISTORY, CONFIG.TABS.MESSAGE_LOG,
      ['MESSAGE_ID', 'TIMESTAMP', 'REID', 'RECIPIENTS', 'CHANNEL', 'CONTENT', 'SCHEDULED_DATE', 'STATUS', 'SENT_BY']);

    const messageId = generateId('SMS');
    await appendRow(CONFIG.SHEETS.NOTE_HISTORY, `${CONFIG.TABS.MESSAGE_LOG}!A:I`, [
      messageId,
      formatTimestamp(new Date()),
      reid || '',
      to,
      'SMS',
      content,
      '',
      'QUEUED_NOT_SENT',  // Special status indicating SMS is ready but sending disabled
      'Dashboard'
    ]);

    return {
      success: true,
      sent: false,
      messageId,
      status: 'queued_not_sent',
      message: 'SMS queued but sending is currently disabled',
      to,
      content,
      timestamp: new Date().toISOString()
    };
  },

  // Get Quo SMS configuration/status
  getSmsConfig: async () => {
    return {
      success: true,
      sendingEnabled: true,
      apiConfigured: !!process.env.QUO_API_KEY,
      defaultFromId: 'PNRvk9ByeI',  // Management 2
      phoneNumbers: [
        { id: 'PNRvk9ByeI', name: 'Management 2', number: '(501) 291-3308', default: true },
        { id: 'PNAANanpRa', name: 'Main Line', number: '(501) 222-4394' },
        { id: 'PNMXrjAEec', name: 'COLLECTIONS', number: '(501) 913-9995' },
        { id: 'PNpndIvXHT', name: 'Marketing', number: '(501) 777-5502' },
        { id: 'PN3z5OO3wv', name: 'Acquisitions', number: '(501) 271-3211' }
      ],
      testNumber: '+15016729023',
      testAddress: '1400 W Markham St',
      timestamp: new Date().toISOString()
    };
  },

  // ============================================================================
  // GMAIL EMAIL SENDING
  // ============================================================================

  // Send email via Gmail API
  sendEmail: async (data) => {
    const { to, subject, body, reid, htmlBody } = data;

    if (!to) throw new Error('to (email address) is required');
    if (!subject) throw new Error('subject is required');
    if (!body && !htmlBody) throw new Error('body or htmlBody is required');

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(to)) {
      throw new Error('Invalid email address format');
    }

    const FROM_EMAIL = 'contact@rei-realty.com';

    // Check if Gmail is configured
    if (!process.env.GMAIL_REFRESH_TOKEN) {
      // Log the email that would be sent (for testing)
      console.log('EMAIL QUEUED (Gmail not configured):', { to, subject, reid });

      // Write to MESSAGE_LOG for tracking
      await ensureSheetHeaders(CONFIG.SHEETS.NOTE_HISTORY, CONFIG.TABS.MESSAGE_LOG,
        ['MESSAGE_ID', 'TIMESTAMP', 'REID', 'RECIPIENTS', 'CHANNEL', 'CONTENT', 'SCHEDULED_DATE', 'STATUS', 'SENT_BY']);

      const messageId = generateId('EML');
      await appendRow(CONFIG.SHEETS.NOTE_HISTORY, `${CONFIG.TABS.MESSAGE_LOG}!A:I`, [
        messageId,
        formatTimestamp(new Date()),
        reid || '',
        to,
        'EMAIL',
        `Subject: ${subject}\n\n${body || htmlBody}`,
        '',
        'QUEUED_NO_GMAIL',  // Gmail not yet configured
        'Dashboard'
      ]);

      return {
        success: true,
        sent: false,
        messageId,
        status: 'queued_no_gmail',
        message: 'Email queued but Gmail (contact@rei-realty.com) not yet configured',
        to,
        subject,
        timestamp: new Date().toISOString()
      };
    }

    // Gmail OAuth2 client
    const oauth2Client = new google.auth.OAuth2(
      process.env.GMAIL_CLIENT_ID,
      process.env.GMAIL_CLIENT_SECRET,
      'https://developers.google.com/oauthplayground'
    );

    oauth2Client.setCredentials({
      refresh_token: process.env.GMAIL_REFRESH_TOKEN
    });

    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    // Construct email
    const emailContent = htmlBody
      ? [
          `From: REI Realty <${FROM_EMAIL}>`,
          `To: ${to}`,
          `Subject: ${subject}`,
          'MIME-Version: 1.0',
          'Content-Type: text/html; charset=utf-8',
          '',
          htmlBody
        ].join('\r\n')
      : [
          `From: REI Realty <${FROM_EMAIL}>`,
          `To: ${to}`,
          `Subject: ${subject}`,
          'MIME-Version: 1.0',
          'Content-Type: text/plain; charset=utf-8',
          '',
          body
        ].join('\r\n');

    // Encode as base64url
    const encodedEmail = Buffer.from(emailContent)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    // Send via Gmail API
    const response = await gmail.users.messages.send({
      userId: 'me',
      requestBody: {
        raw: encodedEmail
      }
    });

    console.log('Email sent:', { messageId: response.data.id, to, subject, reid });

    // Log to MESSAGE_LOG
    const logId = generateId('EML');
    await appendRow(CONFIG.SHEETS.NOTE_HISTORY, `${CONFIG.TABS.MESSAGE_LOG}!A:I`, [
      logId,
      formatTimestamp(new Date()),
      reid || '',
      to,
      'EMAIL',
      `Subject: ${subject}\n\n${body || '(HTML email)'}`,
      '',
      'SENT',
      'Dashboard'
    ]);

    return {
      success: true,
      sent: true,
      messageId: response.data.id,
      logId,
      status: 'sent',
      to,
      subject,
      timestamp: new Date().toISOString()
    };
  },

  // Get email configuration status
  getEmailConfig: async () => {
    return {
      success: true,
      gmailConfigured: !!process.env.GMAIL_REFRESH_TOKEN,
      fromEmail: 'contact@rei-realty.com',
      timestamp: new Date().toISOString()
    };
  },

  // Check inbox for new emails and log to MESSAGE_LOG
  checkInbox: async (data) => {
    const { maxResults = 20, markAsRead = false } = data || {};

    if (!process.env.GMAIL_REFRESH_TOKEN) {
      return { success: false, error: 'Gmail not configured' };
    }

    const oauth2Client = new google.auth.OAuth2(
      process.env.GMAIL_CLIENT_ID,
      process.env.GMAIL_CLIENT_SECRET,
      'https://developers.google.com/oauthplayground'
    );
    oauth2Client.setCredentials({ refresh_token: process.env.GMAIL_REFRESH_TOKEN });

    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    const listResponse = await gmail.users.messages.list({
      userId: 'me',
      maxResults,
      q: 'is:inbox'
    });

    const messages = listResponse.data.messages || [];
    if (messages.length === 0) {
      return { success: true, emails: [], count: 0, message: 'No emails found' };
    }

    // Get PME data for property matching by email
    let pmeData = {};
    try {
      const pmeRows = await getSheetData(CONFIG.SHEETS.PME, 'PME!A:BZ');
      if (pmeRows.length > 1) {
        const headers = pmeRows[0].map(normalizeHeader);
        const headerMap = {};
        headers.forEach((h, i) => { if (h) headerMap[h.toUpperCase().replace(/\s+/g, '_')] = i; });

        for (let i = 1; i < pmeRows.length; i++) {
          const row = pmeRows[i];
          const reid = row[headerMap['REID']] || '';
          if (!reid) continue;

          const p1Email = String(row[headerMap['P1_EMAIL']] || '').toLowerCase().trim();
          const p2Email = String(row[headerMap['P2_EMAIL']] || '').toLowerCase().trim();
          const p3Email = String(row[headerMap['P3_EMAIL']] || '').toLowerCase().trim();

          if (p1Email) pmeData[p1Email] = { reid, primary: row[headerMap['PRIMARY']] || '', contact: 'P1' };
          if (p2Email) pmeData[p2Email] = { reid, primary: row[headerMap['PRIMARY']] || '', contact: 'P2' };
          if (p3Email) pmeData[p3Email] = { reid, primary: row[headerMap['PRIMARY']] || '', contact: 'P3' };
        }
      }
    } catch (err) {
      console.error('Error loading PME for email matching:', err);
    }

    // Get existing message IDs to avoid duplicates
    let existingIds = new Set();
    try {
      const logRows = await getSheetData(CONFIG.SHEETS.NOTE_HISTORY, `${CONFIG.TABS.MESSAGE_LOG}!A:A`);
      for (let i = 1; i < logRows.length; i++) {
        if (logRows[i][0]) existingIds.add(logRows[i][0]);
      }
    } catch (err) {
      console.log('No existing MESSAGE_LOG or error:', err.message);
    }

    const emails = [];
    let newCount = 0;

    for (const msg of messages) {
      const logId = `GMAIL-${msg.id}`;
      if (existingIds.has(logId)) continue;

      const detail = await gmail.users.messages.get({
        userId: 'me',
        id: msg.id,
        format: 'metadata',
        metadataHeaders: ['From', 'Subject', 'Date']
      });

      const hdrs = detail.data.payload.headers || [];
      const getH = (name) => {
        const h = hdrs.find(h => h.name.toLowerCase() === name.toLowerCase());
        return h ? h.value : '';
      };

      const from = getH('From');
      const subject = getH('Subject');
      const date = getH('Date');
      const isUnread = detail.data.labelIds?.includes('UNREAD');

      // Extract email from "Name <email>" format
      const emailMatch = from.match(/<([^>]+)>/) || [null, from];
      const fromEmail = (emailMatch[1] || from).toLowerCase().trim();

      // Match to property
      const match = pmeData[fromEmail];
      const reid = match?.reid || '';
      const contactType = match?.contact || '';

      emails.push({
        messageId: msg.id,
        logId,
        from,
        fromEmail,
        subject,
        date,
        isUnread,
        reid,
        snippet: detail.data.snippet
      });

      // Log to MESSAGE_LOG
      await ensureSheetHeaders(CONFIG.SHEETS.NOTE_HISTORY, CONFIG.TABS.MESSAGE_LOG,
        ['MESSAGE_ID', 'TIMESTAMP', 'REID', 'RECIPIENTS', 'CHANNEL', 'CONTENT', 'SCHEDULED_DATE', 'STATUS', 'SENT_BY']);

      const content = `From: ${from}\nSubject: ${subject}\n\n${detail.data.snippet}`;
      await appendRow(CONFIG.SHEETS.NOTE_HISTORY, `${CONFIG.TABS.MESSAGE_LOG}!A:I`, [
        logId,
        formatTimestamp(new Date(date)),
        reid,
        fromEmail,
        'EMAIL_INBOUND',
        content,
        '',
        'RECEIVED',
        contactType || 'Unknown'
      ]);

      newCount++;

      if (markAsRead && isUnread) {
        await gmail.users.messages.modify({
          userId: 'me',
          id: msg.id,
          requestBody: { removeLabelIds: ['UNREAD'] }
        });
      }
    }

    console.log(`Inbox check: ${newCount} new emails logged`);

    return {
      success: true,
      emails,
      count: emails.length,
      newCount,
      timestamp: new Date().toISOString()
    };
  },

  // ============================================================================
  // FEEDBACK SYSTEM
  // ============================================================================

  submitFeedback: async (data) => {
    const { user, request } = data;

    if (!user) throw new Error('User is required');
    if (!request) throw new Error('Request/feedback is required');

    const timestamp = formatTimestamp(new Date());
    const feedbackId = generateId('FB');

    // Ensure FEEDBACK tab exists
    await ensureSheetHeaders(CONFIG.SHEETS.NOTE_HISTORY, CONFIG.TABS.FEEDBACK,
      ['FEEDBACK_ID', 'TIMESTAMP', 'USER', 'REQUEST', 'NOTES', 'STATUS']);

    // Write to FEEDBACK tab
    await appendRow(CONFIG.SHEETS.NOTE_HISTORY, `${CONFIG.TABS.FEEDBACK}!A:F`, [
      feedbackId,
      timestamp,
      user,
      request,
      '',  // NOTES - for admin to fill
      'NEW'  // STATUS
    ]);

    console.log('Feedback submitted:', { feedbackId, user });

    return {
      success: true,
      feedbackId,
      message: 'Feedback submitted successfully',
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
    version: '2.2.0',
    cacheStatus: isCacheValid() ? 'valid' : 'stale',
    cacheAge: pmeCache.lastRefresh ? Math.round((Date.now() - pmeCache.lastRefresh) / 1000) + 's' : 'never',
    productionSync: {
      lastB1: productionSyncCache.lastB1Value,
      lastSync: productionSyncCache.lastSyncTime
    },
    timestamp: new Date().toISOString()
  });
});

// ============================================================================
// QUO/OPENPHONE WEBHOOK - INCOMING SMS
// ============================================================================

// POST /webhooks/quo - Receives incoming SMS from Quo/OpenPhone
app.post('/webhooks/quo', async (req, res) => {
  try {
    const event = req.body;
    console.log('Quo webhook received:', JSON.stringify(event).substring(0, 500));

    // OpenPhone sends various event types
    // message.received = incoming SMS
    // Also handle the object directly if type is not at top level
    const eventType = event.type || event.object?.type || (event.data ? 'message.received' : null);

    if ((eventType === 'message.received' || eventType === 'message.delivered') && (event.data || event.object)) {
      const msg = event.data?.object || event.data || event.object || event;
      const from = msg.from || event.from;  // Sender phone number
      const to = msg.to?.[0] || msg.phoneNumberId || event.phoneNumberId;
      const content = msg.content || msg.body || msg.text || '';
      const messageId = msg.id || event.id || generateId('INBOUND');

      // Skip if no content (might be a delivery status update)
      if (!content && eventType === 'message.delivered') {
        console.log('Skipping delivery status update');
        return res.json({ success: true, skipped: 'delivery_status' });
      }

      console.log('Processing inbound SMS:', { from, content: content?.substring(0, 50), messageId });

      // Try to find the property by matching phone number
      let reid = '';
      let primary = '';

      // Ensure cache is ready
      if (!pmeCache.mainData) {
        console.log('PME cache not ready, refreshing...');
        await refreshPMECache();
      }

      if (pmeCache.mainData && pmeCache.headerMap) {
        // Try multiple column name variations for phone numbers
        const phoneColNames = ['P1', 'P2', 'P3', 'PHONE_1', 'PHONE_2', 'PHONE_3', 'PHONE1', 'PHONE2', 'PHONE3', 'PHONE', 'CELL', 'MOBILE'];
        const phoneColIndexes = [];

        for (const name of phoneColNames) {
          if (pmeCache.headerMap[name] !== undefined) {
            phoneColIndexes.push(pmeCache.headerMap[name]);
          }
        }

        const reidIdx = pmeCache.headerMap['REID'];
        const primaryIdx = pmeCache.headerMap['PRIMARY'];

        const fromDigits = (from || '').replace(/\D/g, '').slice(-10);
        console.log('Looking for phone:', fromDigits, 'in', phoneColIndexes.length, 'phone columns');

        if (fromDigits.length === 10) {
          for (let i = 1; i < pmeCache.mainData.length; i++) {
            const row = pmeCache.mainData[i];

            for (const colIdx of phoneColIndexes) {
              const phoneVal = (row[colIdx] || '').replace(/\D/g, '').slice(-10);
              if (phoneVal === fromDigits) {
                reid = row[reidIdx] || '';
                primary = row[primaryIdx] || '';
                console.log('Phone matched! REID:', reid, 'PRIMARY:', primary);
                break;
              }
            }
            if (reid) break;
          }
        }

        if (!reid) {
          console.log('No property match found for phone:', fromDigits);
        }
      } else {
        console.log('PME cache still not available');
      }

      // Log to MESSAGE_LOG
      await ensureSheetHeaders(CONFIG.SHEETS.NOTE_HISTORY, CONFIG.TABS.MESSAGE_LOG,
        ['MESSAGE_ID', 'TIMESTAMP', 'REID', 'RECIPIENTS', 'CHANNEL', 'CONTENT', 'SCHEDULED_DATE', 'STATUS', 'SENT_BY']);

      await appendRow(CONFIG.SHEETS.NOTE_HISTORY, `${CONFIG.TABS.MESSAGE_LOG}!A:I`, [
        messageId,
        formatTimestamp(new Date()),
        reid,
        from,  // Who sent it
        'SMS_INBOUND',
        content,
        '',
        'RECEIVED',
        `From: ${from}${primary ? ` (${primary})` : ''}`
      ]);

      console.log('Inbound SMS logged:', { messageId, from, reid, content: content?.substring(0, 50) });
    } else {
      console.log('Unhandled webhook event type:', eventType);
    }

    res.json({ success: true, received: true });
  } catch (err) {
    console.error('Quo webhook error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================================================
// PRODUCTION SYNC CRON ENDPOINT
// ============================================================================

// GET /cron/production-sync - Called every 30 minutes by external scheduler
app.get('/cron/production-sync', async (req, res) => {
  const startTime = Date.now();
  console.log('Cron: Production sync triggered');

  try {
    const result = await runProductionSync(false);

    res.json({
      ...result,
      cronTrigger: true,
      latencyMs: Date.now() - startTime
    });
  } catch (error) {
    console.error('Cron sync error:', error.message);
    res.status(500).json({
      success: false,
      error: error.message,
      cronTrigger: true,
      latencyMs: Date.now() - startTime
    });
  }
});

// GET /cron/production-sync/force - Force sync regardless of B1 change
app.get('/cron/production-sync/force', async (req, res) => {
  const startTime = Date.now();
  console.log('Cron: Force production sync triggered');

  try {
    const result = await runProductionSync(true);

    res.json({
      ...result,
      cronTrigger: true,
      forced: true,
      latencyMs: Date.now() - startTime
    });
  } catch (error) {
    console.error('Cron force sync error:', error.message);
    res.status(500).json({
      success: false,
      error: error.message,
      cronTrigger: true,
      forced: true,
      latencyMs: Date.now() - startTime
    });
  }
});

// ============================================================================
// FAST AGGREGATION ENDPOINTS (cached, ~5ms response)
// ============================================================================

// Get all aggregates instantly from cache
app.get('/aggregates', async (req, res) => {
  const startTime = Date.now();

  if (!isCacheValid()) {
    await refreshPMECache();
  }

  if (!pmeCache.aggregates) {
    return res.status(503).json({ error: 'Cache not ready', cached: false });
  }

  res.json({
    ...pmeCache.aggregates,
    cached: true,
    cacheAge: Math.round((Date.now() - pmeCache.lastRefresh) / 1000),
    latencyMs: Date.now() - startTime
  });
});

// Fast GROSS RCPTS total
app.get('/aggregates/gross-rcpts', async (req, res) => {
  const startTime = Date.now();

  if (!isCacheValid()) {
    await refreshPMECache();
  }

  if (!pmeCache.aggregates) {
    return res.status(503).json({ error: 'Cache not ready' });
  }

  res.json({
    total: pmeCache.aggregates.grossRcptsTotal,
    count: pmeCache.aggregates.grossRcptsCount,
    formatted: '$' + pmeCache.aggregates.grossRcptsTotal.toLocaleString('en-US', { minimumFractionDigits: 2 }),
    cached: true,
    latencyMs: Date.now() - startTime
  });
});

// Fast rent total
app.get('/aggregates/rent', async (req, res) => {
  const startTime = Date.now();

  if (!isCacheValid()) {
    await refreshPMECache();
  }

  if (!pmeCache.aggregates) {
    return res.status(503).json({ error: 'Cache not ready' });
  }

  res.json({
    total: pmeCache.aggregates.rentTotal,
    count: pmeCache.aggregates.rentCount,
    formatted: '$' + pmeCache.aggregates.rentTotal.toLocaleString('en-US', { minimumFractionDigits: 2 }),
    cached: true,
    latencyMs: Date.now() - startTime
  });
});

// Property counts by status
app.get('/aggregates/status', async (req, res) => {
  const startTime = Date.now();

  if (!isCacheValid()) {
    await refreshPMECache();
  }

  if (!pmeCache.aggregates) {
    return res.status(503).json({ error: 'Cache not ready' });
  }

  res.json({
    statusCounts: pmeCache.aggregates.statusCounts,
    total: pmeCache.aggregates.propertyCount,
    cached: true,
    latencyMs: Date.now() - startTime
  });
});

// Force cache refresh
app.post('/cache/refresh', async (req, res) => {
  const startTime = Date.now();
  await refreshPMECache();

  res.json({
    success: true,
    refreshed: true,
    latencyMs: Date.now() - startTime,
    propertyCount: pmeCache.aggregates?.propertyCount || 0
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
  console.log(`REI API v2.2.0 running on port ${PORT}`);

  // Initialize cache on startup
  refreshPMECache().then(() => {
    console.log('PME cache initialized on startup');
  }).catch(err => {
    console.error('Failed to initialize PME cache:', err.message);
  });

  // Run initial production sync after 10 seconds (allow auth to initialize)
  setTimeout(() => {
    console.log('Running initial production sync...');
    runProductionSync(false)
      .then(result => {
        console.log('Initial production sync result:', result.success ? 'OK' : result.error);
      })
      .catch(err => {
        console.error('Initial production sync error:', err.message);
      });
  }, 10000);
});

module.exports = { app };
