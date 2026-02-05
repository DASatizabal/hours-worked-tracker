# Hours Worked Tracker - TODO

## Priority: Deploy & Verify (USER ACTION NEEDED)
- [x] Deploy updated camelCase function to Apps Script editor & redeploy — confirmed deployed
- [x] Verify Google Sheets sync end-to-end — ID and ProjectID columns working (Test 1 passed)
- [x] Deploy v1.5.2 google-apps-script.js — EstimatedArrival parsing, clearEmailPayouts utility
- [ ] **Update Google Sheet tabs** (one-time cleanup):
  - Remove StartTime, EndTime columns from WorkSessions tab
  - Remove Payments tab (optional - no longer used)
- [ ] Clean up old manually-entered data — remove test entries, verify all have IDs

## v1.5.x Features (COMPLETED)
- [x] Pipeline overhaul: calculate from WorkSessions + EmailPayouts instead of Payments table
- [x] Submitted = work sessions where payout time hasn't elapsed
- [x] Available for Payout = sessions past time - DA email totals
- [x] In PayPal = DA email totals - PayPal transfer totals
- [x] Transferring/In Bank based on PayPal transfer EstimatedArrival
- [x] Parse "Estimated arrival: X business day" from PayPal emails
- [x] Automatic hourly email scanning trigger (setupEmailTrigger)
- [x] DA payout cooldown timer (72h countdown with color coding)
- [x] Auto-refresh pipeline every 60 seconds

## Testing (USER ACTION NEEDED)
- [x] Test Project work type — amount + hours/min + auto hourly rate (Test 2 passed)
- [x] Test Task work type — only Amount Paid shows (Test 2 passed)
- [ ] Test edit/delete sessions — verify pre-fill works, delete removes from sheet

## Cross-Repo Integration
- [x] Sync "November Cruise" goal with `/cruise-payment-tracker` (v1.5.5)
  - Auto-reads `cruise-payments` localStorage on load
  - Sums David's payments and displays as goal progress
  - Shows "Auto-synced" badge on cruise goal card

## Completed Features
- [x] Dashboard "Total Amount to be Paid" shows earnings minus In Bank (v1.3.0)
- [x] Tax card label shows configured rate dynamically (v1.3.2)
- [x] Goal emoji icon picker (v1.3.0)
- [x] Fast modal/delete feedback (v1.3.0-v1.4.0)
- [x] Double-submit prevention on all forms (v1.3.0)
