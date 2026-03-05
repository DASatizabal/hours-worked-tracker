/**
 * Google Apps Script Backend for Hours Worked Tracker
 * VERSION: 2.0.11
 *
 * Supports 5-tab CRUD + Gmail email parsing for DA/PayPal payouts.
 *
 * SETUP: See SETUP.md for full instructions.
 */

// IMPORTANT: Replace with your actual Sheet ID
const SHEET_ID = '1y1Jjk056nBMP99c_N1YIeUDG3-kpYqmnctydOnZtcbE';

// Tab configurations: column headers for each tab
// Tabs with user-scoped data have UserEmail as first column
const USER_SCOPED_TABS = ['WorkSessions', 'Goals', 'GoalAllocations', 'EmailPayouts'];

const TABS = {
  WorkSessions: ['UserEmail', 'Date', 'Duration', 'Type', 'ProjectID', 'Notes', 'HourlyRate', 'Earnings', 'SubmittedAt', 'ID'],
  Goals: ['UserEmail', 'Name', 'Icon', 'TargetAmount', 'SavedAmount', 'CreatedAt', 'CompletedAt', 'ID'],
  GoalAllocations: ['UserEmail', 'GoalId', 'PaymentId', 'Amount', 'Date', 'Notes', 'ID'],
  EmailPayouts: ['UserEmail', 'Source', 'DAPaymentId', 'Amount', 'ReceivedAt', 'PaypalTransactionId', 'EstimatedArrival', 'ID'],
  CruisePayments: ['Person', 'Amount', 'Date', 'Note', 'Source', 'ID'],
  Settings: ['Key', 'Value']
};

// ============ HTTP Handlers ============

function doGet(e) {
  try {
    const action = e.parameter.action;

    // Email scan action
    if (action === 'scanEmails') {
      return createResponse(scanEmails(e.parameter.userEmail || ''));
    }

    // Dedup: flag or delete duplicate WorkSessions
    if (action === 'flagDuplicates') {
      return createResponse(flagDuplicateWorkSessions());
    }
    if (action === 'deleteFlaggedDuplicates') {
      return createResponse(deleteFlaggedDuplicates());
    }

    // Lightweight scan status check for client polling
    if (action === 'getScanStatus') {
      var props = PropertiesService.getScriptProperties();
      return createResponse({
        lastScanTime: props.getProperty('lastScanTime') || null,
        lastScanNewRecords: parseInt(props.getProperty('lastScanNewRecords') || '0', 10)
      });
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
    const userEmail = (e.parameter.userEmail || '').toLowerCase();
    const view = e.parameter.view || 'personal';
    const isUserScoped = USER_SCOPED_TABS.indexOf(tab) !== -1;

    const records = data.slice(1).map(row => {
      const record = {};
      headers.forEach((h, i) => {
        let val = row[i];
        if (val instanceof Date) val = val.toISOString().split('T')[0];
        record[camelCase(h)] = val !== undefined && val !== null ? val : '';
      });
      return record;
    }).filter(r => r.id || r.key); // Filter empty rows

    // Filter by user in personal view (skip for shared tabs or family view)
    if (userEmail && view === 'personal' && isUserScoped) {
      var filtered = records.filter(function(r) {
        var recEmail = (r.userEmail || '').toLowerCase();
        return !recEmail || recEmail === userEmail;
      });
      return createResponse({ records: filtered });
    }

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
    } else if (action === 'upsertSetting' && tab === 'Settings') {
      return upsertSetting(data.key, data.value);
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

  // Dedup guard for WorkSessions: reject if a row with the same UserEmail + Date + Earnings already exists
  if (tab === 'WorkSessions' && record.date) {
    var userCol = headers.indexOf('UserEmail');
    var dateCol = headers.indexOf('Date');
    var earnCol = headers.indexOf('Earnings');
    if (dateCol !== -1 && earnCol !== -1) {
      var data = sheet.getDataRange().getValues();
      var newEarnings = parseFloat(record.earnings) || 0;
      var newDate = String(record.date).slice(0, 10);
      var newUserEmail = (record.userEmail || '').toLowerCase();
      for (var i = 1; i < data.length; i++) {
        // Only check duplicates for the same user
        var rowEmail = userCol !== -1 ? (data[i][userCol] || '').toString().toLowerCase() : '';
        if (newUserEmail && rowEmail && rowEmail !== newUserEmail) continue;
        var rowDate = data[i][dateCol] instanceof Date
          ? data[i][dateCol].toISOString().split('T')[0]
          : String(data[i][dateCol]).slice(0, 10);
        if (rowDate === newDate &&
            (parseFloat(data[i][earnCol]) || 0) === newEarnings) {
          return createResponse({ success: true, duplicate: true, record: record });
        }
      }
    }
  }

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

function upsertSetting(key, value) {
  const sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName('Settings');
  if (!sheet) return createResponse({ error: 'Settings tab not found' }, 404);

  const data = sheet.getDataRange().getValues();
  // Column 0 = Key, Column 1 = Value
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === key) {
      sheet.getRange(i + 1, 2).setValue(value);
      return createResponse({ success: true, action: 'updated', key, value });
    }
  }

  // Key not found — append new row
  sheet.appendRow([key, value]);
  return createResponse({ success: true, action: 'created', key, value });
}

// ============ Email Scanning ============

function scanEmails(userEmail) {
  const results = { daPayouts: 0, paypalTransfers: 0, chaseDeposits: 0, sccuDeposits: 0, newRecords: 0, errors: [] };

  try {
    // Tag all records with the caller's email for multi-user support
    // When called from a time trigger, userEmail is an event object — fall back to Session API
    var deployerEmail = '';
    Logger.log('scanEmails called with userEmail: ' + JSON.stringify(userEmail) + ' type: ' + typeof userEmail);
    if (typeof userEmail === 'string' && userEmail.indexOf('@') > -1) {
      deployerEmail = userEmail;
    } else {
      try { deployerEmail = Session.getEffectiveUser().getEmail() || ''; } catch(e) {}
    }
    Logger.log('deployerEmail resolved to: ' + deployerEmail);
    // Scan DA payout emails (last 30 days) - money moved to PayPal
    const daThreads = GmailApp.search('from:noreply@mail.dataannotation.tech subject:"New Payout" newer_than:30d', 0, 50);
    Logger.log('DA threads found: ' + daThreads.length);
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
    Logger.log('PayPal threads found: ' + ppTransferThreads.length);
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

    // Scan Chase deposit emails (David only) - money confirmed in bank
    let chaseDeposits = [];
    if (deployerEmail.toLowerCase() === 'dasatizabal@gmail.com') {
      const chaseThreads = GmailApp.search('from:no.reply.alerts@chase.com subject:"direct deposit posted" newer_than:30d', 0, 50);
      Logger.log('Chase threads found: ' + chaseThreads.length);

      chaseThreads.forEach(thread => {
        thread.getMessages().forEach(msg => {
          try {
            const parsed = parseChaseDepositEmail(msg);
            if (parsed) {
              chaseDeposits.push(parsed);
              results.chaseDeposits++;
            }
          } catch (err) {
            results.errors.push('Chase parse error: ' + err.message);
          }
        });
      });
    } else {
      Logger.log('Skipping Chase scan (not David)');
    }

    // Scan SCCU deposit emails (Lisa only) - money confirmed in bank
    let sccuDeposits = [];
    if (deployerEmail.toLowerCase() === 'lisasatizabal@gmail.com') {
      const sccuThreads = GmailApp.search('from:payments@sccu.com subject:"We deposited your payment" newer_than:30d', 0, 50);
      Logger.log('SCCU threads found: ' + sccuThreads.length);

    sccuThreads.forEach(thread => {
      thread.getMessages().forEach(msg => {
        try {
          const parsed = parseSCCUDepositEmail(msg);
          if (parsed) {
            sccuDeposits.push(parsed);
            results.sccuDeposits++;
          }
        } catch (err) {
          results.errors.push('SCCU parse error: ' + err.message);
        }
      });
    });
    } else {
      Logger.log('Skipping SCCU scan (not Lisa)');
    }

    // Save to EmailPayouts tab
    const sheet = SpreadsheetApp.openById(SHEET_ID);
    const emailSheet = sheet.getSheetByName('EmailPayouts');

    if (!emailSheet) {
      results.errors.push('Missing EmailPayouts tab');
      var props = PropertiesService.getScriptProperties();
      props.setProperty('lastScanTime', new Date().toISOString());
      props.setProperty('lastScanNewRecords', '0');
      return { results };
    }

    // Get existing email payouts to avoid duplicates
    const existingEmails = getExistingEmailPayouts(emailSheet);

    // Save DA payouts: UserEmail, Source, DAPaymentId, Amount, ReceivedAt, PaypalTransactionId, EstimatedArrival, ID
    daPayouts.forEach(dp => {
      if (!existingEmails.has(dp.daPaymentId + '_da')) {
        const id = 'email_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        emailSheet.appendRow([deployerEmail, 'dataannotation', dp.daPaymentId, dp.amount, dp.receivedAt, '', '', id]);
        existingEmails.set(dp.daPaymentId + '_da', id);
        results.newRecords++;
      }
    });

    // Save PayPal transfer records
    ppTransfers.forEach(pt => {
      if (!existingEmails.has(pt.paypalTransactionId + '_pptx')) {
        const id = 'email_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        emailSheet.appendRow([deployerEmail, 'paypal_transfer', '', pt.amount, pt.receivedAt, pt.paypalTransactionId, pt.estimatedArrival || '', id]);
        existingEmails.set(pt.paypalTransactionId + '_pptx', id);
        results.newRecords++;
      }
    });

    // Filter bank deposits: only keep those matching a PayPal transfer amount.
    // This prevents non-DA deposits (salary, etc.) from polluting the pipeline.
    var availablePaypalAmounts = [];
    var existingBankAmounts = [];
    var sheetData = emailSheet.getDataRange().getValues();
    for (var i = 1; i < sheetData.length; i++) {
      var rowSource = sheetData[i][1];
      var rowAmount = parseFloat(sheetData[i][3]) || 0;
      if (rowSource === 'paypal_transfer') availablePaypalAmounts.push(rowAmount);
      if (rowSource === 'chase_deposit' || rowSource === 'sccu_deposit') existingBankAmounts.push(rowAmount);
    }
    // Consume PayPal amounts already matched to existing bank deposits
    existingBankAmounts.forEach(function(amt) {
      var idx = availablePaypalAmounts.indexOf(amt);
      if (idx !== -1) availablePaypalAmounts.splice(idx, 1);
    });
    // Only keep new bank deposits that match an unmatched PayPal transfer
    chaseDeposits = chaseDeposits.filter(function(cd) {
      var idx = availablePaypalAmounts.indexOf(cd.amount);
      if (idx !== -1) { availablePaypalAmounts.splice(idx, 1); return true; }
      Logger.log('Skipping Chase deposit $' + cd.amount + ' — no matching PayPal transfer');
      return false;
    });
    sccuDeposits = sccuDeposits.filter(function(sd) {
      var idx = availablePaypalAmounts.indexOf(sd.amount);
      if (idx !== -1) { availablePaypalAmounts.splice(idx, 1); return true; }
      Logger.log('Skipping SCCU deposit $' + sd.amount + ' — no matching PayPal transfer');
      return false;
    });

    // Save Chase deposit records (only PayPal-matched)
    chaseDeposits.forEach(cd => {
      if (!existingEmails.has(cd.chaseMessageId + '_chase')) {
        const id = 'email_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        emailSheet.appendRow([deployerEmail, 'chase_deposit', cd.chaseMessageId, cd.amount, cd.receivedAt, '', '', id]);
        existingEmails.set(cd.chaseMessageId + '_chase', id);
        results.newRecords++;
      }
    });

    // Save SCCU deposit records (only PayPal-matched)
    sccuDeposits.forEach(sd => {
      if (!existingEmails.has(sd.confirmationNumber + '_sccu')) {
        const id = 'email_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        emailSheet.appendRow([deployerEmail, 'sccu_deposit', sd.confirmationNumber, sd.amount, sd.receivedAt, '', '', id]);
        existingEmails.set(sd.confirmationNumber + '_sccu', id);
        results.newRecords++;
      }
    });

    // Match bank deposits to in-progress PayPal transfers
    // When a deposit amount matches a transferring PayPal amount,
    // update the PayPal transfer's EstimatedArrival to the deposit date
    // so the pipeline immediately moves it to "In Bank"
    // Include ALL bank deposits (newly scanned + already in sheet) so manual entries get matched too
    var allBankDeposits = chaseDeposits.concat(sccuDeposits);
    var freshData = emailSheet.getDataRange().getValues();
    for (var i = 1; i < freshData.length; i++) {
      var src = freshData[i][1];
      if (src === 'chase_deposit' || src === 'sccu_deposit') {
        allBankDeposits.push({ amount: parseFloat(freshData[i][3]) || 0, receivedAt: freshData[i][4] });
      }
    }
    matchBankDepositsToTransfers(emailSheet, allBankDeposits);

  } catch (error) {
    Logger.log('SCAN ERROR: ' + error.message);
    results.errors.push('Scan error: ' + error.message);
  }

  Logger.log('Final results: ' + JSON.stringify(results));

  // Store scan metadata for lightweight client polling
  var props = PropertiesService.getScriptProperties();
  props.setProperty('lastScanTime', new Date().toISOString());
  props.setProperty('lastScanNewRecords', String(results.newRecords));

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

  // Extract estimated arrival
  let estimatedArrival = '';
  const months = { january: 0, february: 1, march: 2, april: 3, may: 4, june: 5, july: 6, august: 7, september: 8, october: 9, november: 10, december: 11 };

  // Try to find transaction date (e.g., "February 4, 2026")
  const txnDateMatch = body.match(/(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),?\s*(\d{4})/i);
  let txnDate = null;
  if (txnDateMatch) {
    const month = months[txnDateMatch[1].toLowerCase()];
    const day = parseInt(txnDateMatch[2]);
    const year = parseInt(txnDateMatch[3]);
    txnDate = new Date(year, month, day);
  }

  // Try to find "Estimated arrival: X business day(s)"
  const businessDaysMatch = body.match(/Estimated\s*arrival[:\s]*(\d+)\s*business\s*day/i);
  if (businessDaysMatch && txnDate) {
    const numDays = parseInt(businessDaysMatch[1]);
    estimatedArrival = addBusinessDays(txnDate, numDays).toISOString();
  } else {
    // Try "by February 4" pattern
    const byDateMatch = body.match(/by\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2})/i);
    if (byDateMatch) {
      const month = months[byDateMatch[1].toLowerCase()];
      const day = parseInt(byDateMatch[2]);
      const year = new Date().getFullYear();
      const arrivalDate = new Date(year, month, day);
      if (arrivalDate < new Date()) arrivalDate.setFullYear(year + 1);
      estimatedArrival = arrivalDate.toISOString();
    } else if (txnDate) {
      // Fallback: transaction date + 1 business day
      estimatedArrival = addBusinessDays(txnDate, 1).toISOString();
    } else {
      // Last resort: email date + 1 business day
      estimatedArrival = addBusinessDays(new Date(date), 1).toISOString();
    }
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

function parseChaseDepositEmail(msg) {
  const body = msg.getPlainBody() || msg.getBody();
  const date = msg.getDate().toISOString();

  // Extract amount (e.g., "$300.00")
  const amountMatch = body.match(/\$([0-9,]+\.?\d*)/);
  const amount = amountMatch ? parseFloat(amountMatch[1].replace(',', '')) : 0;

  if (amount <= 0) return null;

  return {
    source: 'chase_deposit',
    chaseMessageId: 'chase_' + msg.getId(),
    amount,
    receivedAt: date
  };
}

function parseSCCUDepositEmail(msg) {
  const body = msg.getPlainBody() || msg.getBody();
  const date = msg.getDate().toISOString();

  // Only match deposits to the specific account we're tracking
  if (!/account\s+ending\s+in\s+7300/i.test(body)) return null;

  // Extract amount (e.g., "$665.70 payment")
  const amountMatch = body.match(/\$([0-9,]+\.?\d*)\s*payment/i) ||
                      body.match(/\$([0-9,]+\.?\d*)/);
  const amount = amountMatch ? parseFloat(amountMatch[1].replace(',', '')) : 0;

  // Extract confirmation number
  const confMatch = body.match(/confirmation\s*number\s*(\d+)/i);
  const confirmationNumber = confMatch ? confMatch[1] : 'sccu_' + msg.getId();

  if (amount <= 0) return null;

  return {
    source: 'sccu_deposit',
    confirmationNumber,
    amount,
    receivedAt: date
  };
}

function matchBankDepositsToTransfers(emailSheet, bankDeposits) {
  if (bankDeposits.length === 0) {
    Logger.log('matchBankDeposits: no bank deposits to match');
    return;
  }

  const now = new Date();
  const data = emailSheet.getDataRange().getValues();
  // Column indices (with UserEmail): UserEmail=0, Source=1, DAPaymentId=2, Amount=3, ReceivedAt=4, PaypalTransactionId=5, EstimatedArrival=6, ID=7

  // Build list of deposit amounts for matching (round to 2 decimals to avoid float issues)
  const depositAmounts = bankDeposits.map(d => Math.round((parseFloat(d.amount) || 0) * 100) / 100);
  Logger.log('matchBankDeposits: ' + bankDeposits.length + ' deposits, amounts: ' + JSON.stringify(depositAmounts));

  for (let i = 1; i < data.length; i++) {
    if (data[i][1] !== 'paypal_transfer') continue;

    const transferAmount = Math.round((parseFloat(data[i][3]) || 0) * 100) / 100;
    const estimatedArrival = data[i][6] ? new Date(data[i][6]) : null;

    Logger.log('matchBankDeposits: checking PayPal $' + transferAmount + ' est:' + (estimatedArrival ? estimatedArrival.toISOString() : 'none') + ' future:' + (estimatedArrival && now < estimatedArrival));

    // Only match transfers still "in progress" (estimated arrival in the future)
    if (!estimatedArrival || now >= estimatedArrival) continue;

    // Check if any bank deposit matches this transfer amount
    const matchIdx = depositAmounts.indexOf(transferAmount);
    if (matchIdx !== -1) {
      // Update EstimatedArrival to the deposit date (in the past) so pipeline sees it as "In Bank"
      const depositDate = bankDeposits[matchIdx].receivedAt;
      Logger.log('matchBankDeposits: MATCHED PayPal $' + transferAmount + ' -> deposit date ' + depositDate);
      emailSheet.getRange(i + 1, 7).setValue(depositDate instanceof Date ? depositDate.toISOString() : depositDate); // Column 7 = EstimatedArrival (1-indexed)

      // Remove matched deposit so it doesn't match again
      depositAmounts.splice(matchIdx, 1);
      bankDeposits.splice(matchIdx, 1);
      if (bankDeposits.length === 0) break;
    }
  }
}

function getExistingEmailPayouts(emailSheet) {
  // Column indices (with UserEmail): UserEmail=0, Source=1, DAPaymentId=2, Amount=3, ReceivedAt=4, PaypalTransactionId=5, EstimatedArrival=6, ID=7
  const existing = new Map();
  const data = emailSheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    const source = data[i][1];
    const daId = data[i][2];
    const ppTxn = data[i][5];
    const id = data[i][7];
    if (source === 'dataannotation' && daId) existing.set(daId + '_da', id);
    if (source === 'paypal_transfer' && ppTxn) existing.set(ppTxn + '_pptx', id);
    if (source === 'chase_deposit' && daId) existing.set(daId + '_chase', id);
    if (source === 'sccu_deposit' && daId) existing.set(daId + '_sccu', id);
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

// ============ Automatic Email Scanning ============

// Set up hourly trigger to automatically scan emails
// Run this function once manually to enable automatic scanning
function setupEmailTrigger() {
  // Remove any existing triggers first
  removeEmailTriggers();

  // Create new hourly trigger
  ScriptApp.newTrigger('scanEmails')
    .timeBased()
    .everyHours(1)
    .create();

  Logger.log('Email scan trigger created - will run every hour');
}

// Remove all email scan triggers
function removeEmailTriggers() {
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(trigger => {
    if (trigger.getHandlerFunction() === 'scanEmails') {
      ScriptApp.deleteTrigger(trigger);
      Logger.log('Removed existing scanEmails trigger');
    }
  });
}

// Check current trigger status
function checkTriggerStatus() {
  const triggers = ScriptApp.getProjectTriggers();
  const emailTriggers = triggers.filter(t => t.getHandlerFunction() === 'scanEmails');

  if (emailTriggers.length === 0) {
    Logger.log('No email scan triggers found. Run setupEmailTrigger() to enable automatic scanning.');
  } else {
    emailTriggers.forEach(t => {
      Logger.log('Found trigger: ' + t.getHandlerFunction() + ' - runs every ' + t.getTriggerSource());
    });
  }
}

// ============ Data Cleanup Utilities ============

// Add missing IDs to WorkSessions rows (useful after manual data entry)
function addMissingIds() {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var sheet = ss.getSheetByName('WorkSessions');
  var data = sheet.getDataRange().getValues();
  var idCol = data[0].indexOf('ID');
  var count = 0;
  for (var i = 1; i < data.length; i++) {
    if (!data[i][idCol]) {
      var id = 'ws_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
      sheet.getRange(i + 1, idCol + 1).setValue(id);
      count++;
      Utilities.sleep(10); // ensure unique timestamps
    }
  }
  Logger.log('Added IDs to ' + count + ' rows');
}

// Find and highlight duplicate WorkSessions (same SubmittedAt + Earnings).
// Keeps the earliest row (lowest row number) and highlights later duplicates in red.
// Run this manually from the Apps Script editor, then review the red rows and delete them.
function flagDuplicateWorkSessions() {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var sheet = ss.getSheetByName('WorkSessions');
  var data = sheet.getDataRange().getValues();
  var headers = data[0];
  var userCol = headers.indexOf('UserEmail');
  var subCol = headers.indexOf('SubmittedAt');
  var earnCol = headers.indexOf('Earnings');
  var idCol = headers.indexOf('ID');
  var noteCol = headers.indexOf('Notes');
  var dateCol = headers.indexOf('Date');
  var durCol = headers.indexOf('Duration');

  if (dateCol === -1 || earnCol === -1) {
    return { error: 'Missing Date or Earnings column' };
  }

  // Build map of (userEmail + date + earnings) -> first row index
  var seen = {};
  var duplicates = [];

  for (var i = 1; i < data.length; i++) {
    var rowDate = data[i][dateCol] instanceof Date
      ? data[i][dateCol].toISOString().split('T')[0]
      : String(data[i][dateCol]).slice(0, 10);
    var rowEmail = userCol !== -1 ? (data[i][userCol] || '').toString().toLowerCase() : '';
    var key = rowEmail + '|' + rowDate + '|' + String(parseFloat(data[i][earnCol]) || 0);
    if (seen[key] !== undefined) {
      duplicates.push({
        row: i + 1,
        duplicateOf: seen[key].row,
        earnings: data[i][earnCol],
        date: data[i][dateCol],
        duration: data[i][durCol],
        submittedAt: String(data[i][subCol]),
        notes: data[i][noteCol],
        id: data[i][idCol],
        keptId: seen[key].id
      });
      // Highlight in red
      sheet.getRange(i + 1, 1, 1, headers.length).setBackground('#ffcccc');
    } else {
      seen[key] = { row: i + 1, id: data[i][idCol] };
    }
  }

  var msg = 'Found ' + duplicates.length + ' duplicate(s) out of ' + (data.length - 1) + ' rows. Highlighted in red.';
  Logger.log(msg);
  return { message: msg, totalRows: data.length - 1, duplicates: duplicates };
}

// Remove all red-highlighted duplicate rows (run after reviewing flagDuplicateWorkSessions results).
// Deletes rows from bottom to top to preserve row indices.
function deleteFlaggedDuplicates() {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var sheet = ss.getSheetByName('WorkSessions');
  var data = sheet.getDataRange().getValues();
  var deleted = 0;

  for (var i = data.length - 1; i >= 1; i--) {
    var bg = sheet.getRange(i + 1, 1).getBackground();
    if (bg === '#ffcccc') {
      sheet.deleteRow(i + 1);
      deleted++;
    }
  }

  var msg = 'Deleted ' + deleted + ' flagged duplicate row(s).';
  Logger.log(msg);
  return { message: msg, deleted: deleted };
}

// Clear all EmailPayouts data (keeps header row) - run before rescanning emails
function clearEmailPayouts() {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var sheet = ss.getSheetByName('EmailPayouts');
  var lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    sheet.deleteRows(2, lastRow - 1);
    Logger.log('Deleted ' + (lastRow - 1) + ' rows from EmailPayouts');
  } else {
    Logger.log('EmailPayouts is already empty');
  }
}

// ============ Multi-User Migration ============

// Run this ONCE from the Apps Script editor to add UserEmail column to all data tabs.
// Inserts UserEmail as column A and backfills existing rows with the primary user's email.
function migrateAddUserEmail() {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var primaryEmail = 'dasatizabal@gmail.com';
  var tabsToMigrate = ['WorkSessions', 'Goals', 'GoalAllocations', 'EmailPayouts'];

  tabsToMigrate.forEach(function(tabName) {
    var sheet = ss.getSheetByName(tabName);
    if (!sheet) {
      Logger.log(tabName + ': Tab not found, skipping.');
      return;
    }

    // Check if UserEmail column already exists
    var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    if (headers[0] === 'UserEmail') {
      Logger.log(tabName + ': UserEmail column already exists, skipping.');
      return;
    }

    // Insert column at position A
    sheet.insertColumnBefore(1);
    sheet.getRange(1, 1).setValue('UserEmail');

    // Fill all existing data rows with primary user email
    var lastRow = sheet.getLastRow();
    if (lastRow > 1) {
      var values = [];
      for (var i = 0; i < lastRow - 1; i++) {
        values.push([primaryEmail]);
      }
      sheet.getRange(2, 1, lastRow - 1, 1).setValues(values);
    }

    Logger.log(tabName + ': Migrated ' + (lastRow - 1) + ' rows with UserEmail = ' + primaryEmail);
  });

  Logger.log('Migration complete!');
}
