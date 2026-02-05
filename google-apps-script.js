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
  WorkSessions: ['Date', 'StartTime', 'EndTime', 'Duration', 'Type', 'ProjectID', 'Notes', 'HourlyRate', 'Earnings', 'SubmittedAt', 'ID'],
  Payments: ['Amount', 'Tax', 'NetAmount', 'Type', 'Status', 'SubmittedAt', 'PayoutExpectedAt', 'PaidOutAt', 'DAPaymentId', 'TransferExpectedAt', 'TransferredAt', 'PaypalTransactionId', 'InBankAt', 'Notes', 'WorkSessionIds', 'ID'],
  Goals: ['Name', 'Icon', 'TargetAmount', 'SavedAmount', 'CreatedAt', 'CompletedAt', 'ID'],
  GoalAllocations: ['GoalId', 'PaymentId', 'Amount', 'Date', 'Notes', 'ID'],
  EmailPayouts: ['Source', 'DAPaymentId', 'Amount', 'ReceivedAt', 'PaypalTransactionId', 'Matched', 'PaymentId', 'ID'],
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
  const results = { daPayouts: 0, paypalReceipts: 0, paypalTransfers: 0, matched: 0, errors: [] };

  try {
    // Scan DA payout emails (last 30 days)
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

    // Scan PayPal receipt emails (last 30 days) - confirms PayPal received DA funds
    const ppThreads = GmailApp.search('from:service@paypal.com subject:"You have a new payout!" newer_than:30d', 0, 50);
    const ppReceipts = [];

    ppThreads.forEach(thread => {
      thread.getMessages().forEach(msg => {
        try {
          const parsed = parsePayPalEmail(msg);
          if (parsed) {
            ppReceipts.push(parsed);
            results.paypalReceipts++;
          }
        } catch (err) {
          results.errors.push('PayPal parse error: ' + err.message);
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

    // Save to EmailPayouts tab and match with Payments
    const sheet = SpreadsheetApp.openById(SHEET_ID);
    const emailSheet = sheet.getSheetByName('EmailPayouts');
    const paymentSheet = sheet.getSheetByName('Payments');

    if (!emailSheet || !paymentSheet) {
      results.errors.push('Missing EmailPayouts or Payments tab');
      return { results };
    }

    // Get existing email payouts to avoid duplicates
    const existingEmails = getExistingEmailPayouts(emailSheet);

    // Save DA payouts
    daPayouts.forEach(dp => {
      if (!existingEmails.has(dp.daPaymentId + '_da')) {
        const id = 'email_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        emailSheet.appendRow(['dataannotation', dp.daPaymentId, dp.amount, dp.receivedAt, '', false, '', id]);
        existingEmails.set(dp.daPaymentId + '_da', id);
      }
    });

    // Save PayPal receipts
    ppReceipts.forEach(pp => {
      if (!existingEmails.has(pp.paypalTransactionId + '_pp')) {
        const id = 'email_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        emailSheet.appendRow(['paypal', pp.daPaymentId || '', pp.amount, pp.receivedAt, pp.paypalTransactionId, false, '', id]);
        existingEmails.set(pp.paypalTransactionId + '_pp', id);
      }
    });

    // Save PayPal transfer records
    ppTransfers.forEach(pt => {
      if (!existingEmails.has(pt.paypalTransactionId + '_pptx')) {
        const id = 'email_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        emailSheet.appendRow(['paypal_transfer', '', pt.amount, pt.receivedAt, pt.paypalTransactionId, false, '', id]);
        existingEmails.set(pt.paypalTransactionId + '_pptx', id);
      }
    });

    // Match and advance pipeline (with auto-create for unmatched DA payouts)
    results.matched = matchAndAdvancePipeline(paymentSheet, emailSheet, daPayouts, ppReceipts, ppTransfers);

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

function parsePayPalEmail(msg) {
  const body = msg.getPlainBody() || msg.getBody();
  const date = msg.getDate().toISOString();

  // Extract amount
  const amountMatch = body.match(/\$([0-9,]+\.?\d*)/);
  const amount = amountMatch ? parseFloat(amountMatch[1].replace(',', '')) : 0;

  // Extract PayPal transaction ID
  const txnMatch = body.match(/transaction\s*(?:id|#|ID)[:\s]*([A-Za-z0-9]+)/i);
  const paypalTransactionId = txnMatch ? txnMatch[1] : 'pp_' + msg.getId();

  // Extract DA payment ID from note field
  const noteMatch = body.match(/note[:\s]*(.*?)(?:\n|$)/i);
  let daPaymentId = '';
  if (noteMatch) {
    const noteIdMatch = noteMatch[1].match(/([A-Za-z0-9]{8,})/);
    if (noteIdMatch) daPaymentId = noteIdMatch[1];
  }

  if (amount <= 0) return null;

  return {
    source: 'paypal',
    daPaymentId,
    amount,
    receivedAt: date,
    paypalTransactionId
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

  if (amount <= 0) return null;

  return {
    source: 'paypal_transfer',
    amount,
    receivedAt: date,
    paypalTransactionId
  };
}

function getExistingEmailPayouts(emailSheet) {
  const existing = new Map();
  const data = emailSheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    const source = data[i][0];
    const daId = data[i][1];
    const ppTxn = data[i][4];
    if (source === 'dataannotation' && daId) existing.set(daId + '_da', data[i][7]);
    if (source === 'paypal' && ppTxn) existing.set(ppTxn + '_pp', data[i][7]);
    if (source === 'paypal_transfer' && ppTxn) existing.set(ppTxn + '_pptx', data[i][7]);
  }
  return existing;
}

function matchAndAdvancePipeline(paymentSheet, emailSheet, daPayouts, ppReceipts, ppTransfers) {
  let matchCount = 0;
  const paymentData = paymentSheet.getDataRange().getValues();
  const headers = TABS.Payments;

  // Track which DA payouts were matched to existing payments
  const matchedDaPayouts = new Set();

  // For each DA payout, find matching payment by amount and advance to paid_out
  daPayouts.forEach((dp, dpIndex) => {
    for (let i = 1; i < paymentData.length; i++) {
      const status = paymentData[i][headers.indexOf('Status')];
      const amount = parseFloat(paymentData[i][headers.indexOf('Amount')]);

      if ((status === 'submitted' || status === 'pending_payout') &&
          Math.abs(amount - dp.amount) < 0.01) {
        // Advance to paid_out
        const row = i + 1;
        paymentSheet.getRange(row, headers.indexOf('Status') + 1).setValue('paid_out');
        paymentSheet.getRange(row, headers.indexOf('PaidOutAt') + 1).setValue(dp.receivedAt);
        paymentSheet.getRange(row, headers.indexOf('DAPaymentId') + 1).setValue(dp.daPaymentId);

        // Calculate transfer expected (3 business days)
        const transferExpected = addBusinessDays(new Date(dp.receivedAt), 3);
        paymentSheet.getRange(row, headers.indexOf('TransferExpectedAt') + 1).setValue(transferExpected.toISOString());

        paymentData[i][headers.indexOf('Status')] = 'paid_out';
        matchedDaPayouts.add(dpIndex);
        matchCount++;
        break;
      }
    }
  });

  // AUTO-CREATE: For unmatched DA payouts, create new payment records at paid_out stage
  daPayouts.forEach((dp, dpIndex) => {
    if (matchedDaPayouts.has(dpIndex)) return;

    // Check if a payment with this DA payment ID already exists (avoid duplicates)
    let alreadyExists = false;
    for (let i = 1; i < paymentData.length; i++) {
      const existingDaId = paymentData[i][headers.indexOf('DAPaymentId')];
      if (existingDaId === dp.daPaymentId) {
        alreadyExists = true;
        break;
      }
    }
    if (alreadyExists) return;

    // Create a new payment record
    const transferExpected = addBusinessDays(new Date(dp.receivedAt), 3);
    const taxRate = 0.35;
    const tax = dp.amount * taxRate;
    const netAmount = dp.amount - tax;
    const paymentId = 'pmt_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);

    const newRow = headers.map(h => {
      switch(h) {
        case 'Amount': return dp.amount;
        case 'Tax': return tax;
        case 'NetAmount': return netAmount;
        case 'Type': return 'project';
        case 'Status': return 'paid_out';
        case 'SubmittedAt': return dp.receivedAt;
        case 'PayoutExpectedAt': return dp.receivedAt;
        case 'PaidOutAt': return dp.receivedAt;
        case 'DAPaymentId': return dp.daPaymentId;
        case 'TransferExpectedAt': return transferExpected.toISOString();
        case 'TransferredAt': return '';
        case 'PaypalTransactionId': return '';
        case 'InBankAt': return '';
        case 'Notes': return 'Auto-created from DA payout email';
        case 'WorkSessionIds': return '';
        case 'ID': return paymentId;
        default: return '';
      }
    });

    paymentSheet.appendRow(newRow);
    paymentData.push(newRow); // Add to local cache for subsequent matching
    matchCount++;
  });

  // For each PayPal receipt ("You have a new payout!"), only add the transaction ID
  // This email confirms PayPal received DA funds - does NOT advance to in_bank
  ppReceipts.forEach(pp => {
    for (let i = 1; i < paymentData.length; i++) {
      const status = paymentData[i][headers.indexOf('Status')];
      const daId = paymentData[i][headers.indexOf('DAPaymentId')];
      const amount = parseFloat(paymentData[i][headers.indexOf('Amount')]);
      const existingPpTxn = paymentData[i][headers.indexOf('PaypalTransactionId')];

      // Match paid_out payments by DA ID or by amount (if no existing PayPal txn)
      if (status === 'paid_out' && !existingPpTxn &&
          ((pp.daPaymentId && daId === pp.daPaymentId) ||
           (!pp.daPaymentId && Math.abs(amount - pp.amount) < 0.01))) {
        const row = i + 1;
        // Only add PayPal transaction ID - do NOT change status
        paymentSheet.getRange(row, headers.indexOf('PaypalTransactionId') + 1).setValue(pp.paypalTransactionId);
        paymentData[i][headers.indexOf('PaypalTransactionId')] = pp.paypalTransactionId;
        matchCount++;
        break;
      }
    }
  });

  // For each PayPal transfer email, advance paid_out to transferring
  (ppTransfers || []).forEach(pt => {
    for (let i = 1; i < paymentData.length; i++) {
      const status = paymentData[i][headers.indexOf('Status')];
      const amount = parseFloat(paymentData[i][headers.indexOf('Amount')]);
      const existingPpTxn = paymentData[i][headers.indexOf('PaypalTransactionId')];

      // Match paid_out payments by amount or by PayPal transaction ID
      if (status === 'paid_out' &&
          (Math.abs(amount - pt.amount) < 0.01 ||
           (existingPpTxn && existingPpTxn === pt.paypalTransactionId))) {
        const row = i + 1;
        paymentSheet.getRange(row, headers.indexOf('Status') + 1).setValue('transferring');
        paymentSheet.getRange(row, headers.indexOf('TransferredAt') + 1).setValue(pt.receivedAt);
        if (!existingPpTxn) {
          paymentSheet.getRange(row, headers.indexOf('PaypalTransactionId') + 1).setValue(pt.paypalTransactionId);
        }

        paymentData[i][headers.indexOf('Status')] = 'transferring';
        matchCount++;
        break;
      }
    }
  });

  return matchCount;
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
