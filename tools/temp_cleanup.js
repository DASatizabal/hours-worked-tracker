function fixDavidMissing() {
  var sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName('EmailPayouts');
  var newRecords = [
    ['dasatizabal@gmail.com', 'paypal_transfer', '', 10.00, '2026-02-04T04:30:00.000Z', 'manual_pp_10_feb4', '2026-02-05T05:00:00.000Z', 'email_fix_pp_10_1'],
    ['dasatizabal@gmail.com', 'paypal_transfer', '', 312.18, '2026-02-10T20:40:00.000Z', 'manual_pp_31218_feb10', '2026-02-11T05:00:00.000Z', 'email_fix_pp_31218_2'],
    ['dasatizabal@gmail.com', 'chase_deposit', 'chase_manual_10_feb5', 10.00, '2026-02-05T05:00:00.000Z', '', '', 'email_fix_chase_10_3'],
    ['dasatizabal@gmail.com', 'chase_deposit', 'chase_manual_31218_feb11', 312.18, '2026-02-11T05:00:00.000Z', '', '', 'email_fix_chase_31218_4'],
    ['dasatizabal@gmail.com', 'chase_deposit', 'chase_manual_63934_mar9', 639.34, '2026-03-09T05:00:00.000Z', '', '', 'email_fix_chase_63934_5']
  ];
  newRecords.forEach(function(row) {
    sheet.appendRow(row);
    Logger.log('Added: ' + row[1] + ' $' + row[3]);
  });
  var data = sheet.getDataRange().getValues();
  var badIds = ['email_1773520382545_8385cghph','email_1773520382334_tbltpb026','email_1773520382178_ggy7scdys'];
  var rowsToDelete = [];
  for (var i = 1; i < data.length; i++) {
    if (badIds.indexOf(data[i][7].toString()) !== -1) rowsToDelete.push(i + 1);
  }
  rowsToDelete.reverse().forEach(function(row) {
    sheet.deleteRow(row);
    Logger.log('Deleted bad SCCU row ' + row);
  });
  var dateFixMap = {
    'email_manual_sccu_16366_1': '2026-03-02T05:00:00.000Z',
    'email_manual_sccu_48230_2': '2026-03-04T05:00:00.000Z',
    'email_manual_sccu_26993_3': '2026-03-09T05:00:00.000Z'
  };
  var freshData = sheet.getDataRange().getValues();
  for (var j = 1; j < freshData.length; j++) {
    var rid = freshData[j][7].toString();
    if (dateFixMap[rid]) {
      sheet.getRange(j + 1, 5).setValue(dateFixMap[rid]);
      Logger.log('Fixed date for ' + rid);
    }
  }
  Logger.log('Done! Added ' + newRecords.length + ' David records, deleted ' + rowsToDelete.length + ' bad Lisa SCCU deposits, fixed 3 dates');
}
