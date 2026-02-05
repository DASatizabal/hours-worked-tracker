/**
 * Google Apps Script Backend for Hours Worked Tracker
 *
 * Supports 6-tab CRUD + Gmail email parsing for DA/PayPal payouts.
 *
 * SETUP: See SETUP.md for full instructions.
 */

// IMPORTANT: Replace with your actual Sheet ID
const SHEET_ID = '1y1Jjk056nBMP99c_N1YIeUDG3-kpYqmnctydOnZtcbE';

// Tab configurations: column headers for each tab
const TABS = {
  WorkSessions: ['Date', 'Duration', 'Type', 'ProjectID', 'Notes', 'HourlyRate', 'Earnings', 'SubmittedAt', 'ID'],
  Goals: ['Name', 'Icon', 'TargetAmount', 'SavedAmount', 'CreatedAt', 'CompletedAt', 'ID'],
  GoalAllocations: ['GoalId', 'PaymentId', 'Amount', 'Date', 'Notes', 'ID'],
  EmailPayouts: ['Source', 'DAPaymentId', 'Amount', 'ReceivedAt', 'PaypalTransactionId', 'EstimatedArrival', 'ID'],
  Settings: ['Key', 'Value']
};

// ============ HTTP Handlers ============

function doGet(e) {
  try {
    const action = e.parameter.action;

    // Email scan action
    if (action === 'scanEmails') {
      return createResponse(scanEmails());
    }

    // Get records from a specific tab
    const tab = e.parameter.tab || 'WorkSessions';
    if (!TABS[tab]) {
      return createResponse({ error: 'Invalid tab: ' + tab }, 400);
    }

    const sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName(tab);
    if (!sheet) {
      return createResponse({ error: 'Sheet tab "' + tab + '" not found' }, 404);
    }

    const data = sheet.getDataRange().getValues();
    if (data.length <= 1) {
      return createResponse({ records: [] });
    }

    const headers = TABS[tab];
    const records = data.slice(1).map(row => {
      const record = {};
      headers.forEach((h, i) => {
        let val = row[i];
        if (val instanceof Date) val = val.toISOString().split('T')[0];
        record[camelCase(h)] = val !== undefined && val !== null ? val : '';
      });
      return record;
    }).filter(r => r.id || r.key); // Filter empty rows

    return createResponse({ records });
  } catch (error) {
    return createResponse({ error: error.message }, 500);
  }
}

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return createResponse({ error: 'No data received' }, 400);
    }

    const data = JSON.parse(e.postData.contents);
    const action = data.action;
    const tab = data.tab;

    if (!tab || !TABS[tab]) {
      return createResponse({ error: 'Invalid or missing tab' }, 400);
    }

    if (action === 'add') {
      return addRecord(tab, data.record);
    } else if (action === 'update') {
      return updateRecord(tab, data.id, data.updates);
    } else if (action === 'delete') {
      return deleteRecord(tab, data.id);
    }

    return createResponse({ error: 'Unknown action: ' + action }, 400);
  } catch (error) {
    return createResponse({ error: 'Parse error: ' + error.message }, 500);
  }
}

// ============ CRUD Operations ============

function addRecord(tab, record) {
  const sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName(tab);
  if (!sheet) return createResponse({ error: 'Tab not found: ' + tab }, 404);

  const headers = TABS[tab];
  const row = headers.map(h => {
    const key = camelCase(h);
    return record[key] !== undefined ? record[key] : '';
  });

  sheet.appendRow(row);
  return createResponse({ success: true, record: record });
}

function updateRecord(tab, id, updates) {
  const sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName(tab);
  if (!sheet) return createResponse({ error: 'Tab not found: ' + tab }, 404);

  const headers = TABS[tab];
  const idCol = headers.indexOf('ID');
  if (idCol === -1) return createResponse({ error: 'No ID column in ' + tab }, 400);

  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][idCol] === id) {
      headers.forEach((h, col) => {
        const key = camelCase(h);
        if (updates[key] !== undefined) {
          sheet.getRange(i + 1, col + 1).setValue(updates[key]);
        }
      });
      return createResponse({ success: true });
    }
  }

  return createResponse({ error: 'Record not found: ' + id }, 404);
}

function deleteRecord(tab, id) {
  const sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName(tab);
  if (!sheet) return createResponse({ error: 'Tab not found: ' + tab }, 404);

  const headers = TABS[tab];
  const idCol = headers.indexOf('ID');
  // Settings tab uses Key column
  const keyCol = tab === 'Settings' ? headers.indexOf('Key') : idCol;
  if (keyCol === -1) return createResponse({ error: 'No ID/Key column in ' + tab }, 400);

  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][keyCol] === id) {
      sheet.deleteRow(i + 1);
      return createResponse({ success: true, deleted: id });
    }
  }

  return createResponse({ error: 'Record not found: ' + id }, 404);
}

// ============ Email Scanning ============

function scanEmails() {
  const results = { daPayouts: 0, paypalTransfers: 0, newRecords: 0, errors: [] };

  try {
    // Scan DA payout emails (last 30 days) - money moved to PayPal
    const daThreads = GmailApp.search('from:noreply@mail.dataannotation.tech subject:"New Payout!" newer_than:30d', 0, 50);
    const daPayouts = [];

    daThreads.forEach(thread => {
      thread.getMessages().forEach(msg => {
        try {
          const parsed = parseDAPayoutEmail(msg);
          if (parsed) {
            daPayouts.push(parsed);
            results.daPayouts++;
          }
        } catch (err) {
          results.errors.push('DA parse error: ' + err.message);
        }
      });
    });

    // Scan PayPal transfer emails (last 30 days) - money moving to bank
    const ppTransferThreads = GmailApp.search('from:service@paypal.com subject:"Your transfer request is processing" newer_than:30d', 0, 50);
    const ppTransfers = [];

    ppTransferThreads.forEach(thread => {
      thread.getMessages().forEach(msg => {
        try {
          const parsed = parsePayPalTransferEmail(msg);
          if (parsed) {
            ppTransfers.push(parsed);
            results.paypalTransfers++;
          }
        } catch (err) {
          results.errors.push('PayPal transfer parse error: ' + err.message);
        }
      });
    });

    // Save to EmailPayouts tab
    const sheet = SpreadsheetApp.openById(SHEET_ID);
    const emailSheet = sheet.getSheetByName('EmailPayouts');

    if (!emailSheet) {
      results.errors.push('Missing EmailPayouts tab');
      return { results };
    }

    // Get existing email payouts to avoid duplicates
    const existingEmails = getExistingEmailPayouts(emailSheet);

    // Save DA payouts: Source, DAPaymentId, Amount, ReceivedAt, PaypalTransactionId, EstimatedArrival, ID
    daPayouts.forEach(dp => {
      if (!existingEmails.has(dp.daPaymentId + '_da')) {
        const id = 'email_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        emailSheet.appendRow(['dataannotation', dp.daPaymentId, dp.amount, dp.receivedAt, '', '', id]);
        existingEmails.set(dp.daPaymentId + '_da', id);
        results.newRecords++;
      }
    });

    // Save PayPal transfer records
    ppTransfers.forEach(pt => {
      if (!existingEmails.has(pt.paypalTransactionId + '_pptx')) {
        const id = 'email_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        emailSheet.appendRow(['paypal_transfer', '', pt.amount, pt.receivedAt, pt.paypalTransactionId, pt.estimatedArrival || '', id]);
        existingEmails.set(pt.paypalTransactionId + '_pptx', id);
        results.newRecords++;
      }
    });

  } catch (error) {
    results.errors.push('Scan error: ' + error.message);
  }

  return { results };
}

function parseDAPayoutEmail(msg) {
  const body = msg.getPlainBody() || msg.getBody();
  const date = msg.getDate().toISOString();

  // Extract amount - look for dollar amount pattern
  const amountMatch = body.match(/\$([0-9,]+\.?\d*)/);
  const amount = amountMatch ? parseFloat(amountMatch[1].replace(',', '')) : 0;

  // Extract payment ID
  const idMatch = body.match(/payment\s*(?:id|#|ID)[:\s]*([A-Za-z0-9_-]+)/i) ||
                  body.match(/([A-Za-z0-9]{8,})/);
  const daPaymentId = idMatch ? idMatch[1] : 'da_' + msg.getId();

  if (amount <= 0) return null;

  return {
    source: 'dataannotation',
    daPaymentId,
    amount,
    receivedAt: date
  };
}

function parsePayPalTransferEmail(msg) {
  const body = msg.getPlainBody() || msg.getBody();
  const date = msg.getDate().toISOString();

  // Extract amount (e.g., "$5.00 USD" or "$5.00")
  const amountMatch = body.match(/\$([0-9,]+\.?\d*)\s*USD/i) ||
                      body.match(/\$([0-9,]+\.?\d*)/);
  const amount = amountMatch ? parseFloat(amountMatch[1].replace(',', '')) : 0;

  // Extract transaction ID (e.g., "45B70232UT209194H")
  const txnMatch = body.match(/Transaction\s*ID[:\s]*([A-Za-z0-9]+)/i);
  const paypalTransactionId = txnMatch ? txnMatch[1] : 'pptx_' + msg.getId();

  // Extract estimated arrival (e.g., "by February 4" or "in 1 business day")
  let estimatedArrival = '';
  const arrivalMatch = body.match(/by\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2})/i);
  if (arrivalMatch) {
    const months = { january: 0, february: 1, march: 2, april: 3, may: 4, june: 5, july: 6, august: 7, september: 8, october: 9, november: 10, december: 11 };
    const month = months[arrivalMatch[1].toLowerCase()];
    const day = parseInt(arrivalMatch[2]);
    const year = new Date().getFullYear();
    const arrivalDate = new Date(year, month, day);
    // If the date is in the past, assume next year
    if (arrivalDate < new Date()) arrivalDate.setFullYear(year + 1);
    estimatedArrival = arrivalDate.toISOString();
  } else {
    // Fallback: estimate 1 business day from email date
    estimatedArrival = addBusinessDays(new Date(date), 1).toISOString();
  }

  if (amount <= 0) return null;

  return {
    source: 'paypal_transfer',
    amount,
    receivedAt: date,
    paypalTransactionId,
    estimatedArrival
  };
}

function getExistingEmailPayouts(emailSheet) {
  // Column indices: Source=0, DAPaymentId=1, Amount=2, ReceivedAt=3, PaypalTransactionId=4, EstimatedArrival=5, ID=6
  const existing = new Map();
  const data = emailSheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    const source = data[i][0];
    const daId = data[i][1];
    const ppTxn = data[i][4];
    const id = data[i][6];
    if (source === 'dataannotation' && daId) existing.set(daId + '_da', id);
    if (source === 'paypal_transfer' && ppTxn) existing.set(ppTxn + '_pptx', id);
  }
  return existing;
}

function addBusinessDays(date, days) {
  const result = new Date(date);
  let added = 0;
  while (added < days) {
    result.setDate(result.getDate() + 1);
    const day = result.getDay();
    if (day !== 0 && day !== 6) added++;
  }
  return result;
}

// ============ Utilities ============

function createResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

function camelCase(str) {
  // Convert PascalCase header to camelCase key
  // Handles: 'ID' → 'id', 'ProjectID' → 'projectId', 'DAPaymentId' → 'daPaymentId'
  return str
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .replace(/([a-z])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .replace(/_(.)/g, function(_, c) { return c.toUpperCase(); });
}

function formatDate(value) {
  if (!value) return '';
  if (value instanceof Date) return value.toISOString().split('T')[0];
  return String(value);
}

// ============ Setup Verification ============

function testSetup() {
  try {
    const ss = SpreadsheetApp.openById(SHEET_ID);
    Logger.log('SUCCESS: Opened spreadsheet "' + ss.getName() + '"');

    Object.keys(TABS).forEach(tab => {
      const sheet = ss.getSheetByName(tab);
      if (sheet) {
        Logger.log('  OK: Tab "' + tab + '" found (' + sheet.getLastRow() + ' rows)');
      } else {
        Logger.log('  MISSING: Tab "' + tab + '" - creating...');
        const newSheet = ss.insertSheet(tab);
        newSheet.appendRow(TABS[tab]);
        Logger.log('  CREATED: Tab "' + tab + '" with headers');
      }
    });

    Logger.log('Setup verification complete!');
  } catch (error) {
    Logger.log('ERROR: ' + error.message);
    Logger.log('Make sure SHEET_ID is correct: ' + SHEET_ID);
  }
}

// Create all tabs with headers
function initializeTabs() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  Object.keys(TABS).forEach(tab => {
    let sheet = ss.getSheetByName(tab);
    if (!sheet) {
      sheet = ss.insertSheet(tab);
    }
    // Set headers if row 1 is empty
    if (sheet.getLastRow() === 0) {
      sheet.appendRow(TABS[tab]);
    }
  });
  Logger.log('All tabs initialized!');
}
