# Hours Worked Tracker - TODO

## Open Items (USER ACTION NEEDED)
- [ ] **Update Google Sheet tabs** (one-time cleanup):
  - Remove StartTime, EndTime columns from WorkSessions tab
  - Remove Payments tab (optional - no longer used)
- [ ] Clean up old manually-entered data — remove test entries, verify all have IDs
- [ ] Test edit/delete sessions — verify pre-fill works, delete removes from sheet

## v1.7.x Features (COMPLETED)
- [x] DA HTML import to reconcile work sessions and correct submittedAt timestamps (v1.7.0)
- [x] Widen DA import matching window from 1 day to 3 days (v1.7.1)
- [x] Option to import unmatched DA entries as new sessions (v1.7.2)
- [x] Set projectId to DA project name when importing new entries (v1.7.3)
- [x] Fix DA parser to detect tw-ml-5 project name headers (v1.7.4)
- [x] Smart polling to auto-sync when server email scan finds new data (v1.7.5)
- [x] Fix Est. Next Paycheck to exclude already-paid-out amounts (v1.7.6)
- [x] Estimated arrival date under Transferring pipeline stage (v1.7.7)

## v1.6.x Features (COMPLETED)
- [x] Est. Next Paycheck card with configurable payout day (v1.6.0)
- [x] Show gross and net on Est. Next Paycheck card (v1.6.1)

## v1.5.x Features (COMPLETED)
- [x] Pipeline overhaul: calculate from WorkSessions + EmailPayouts instead of Payments table (v1.5.0)
- [x] Submitted = work sessions where payout time hasn't elapsed
- [x] Available for Payout = sessions past time - DA email totals
- [x] In PayPal = DA email totals - PayPal transfer totals
- [x] Transferring/In Bank based on PayPal transfer EstimatedArrival
- [x] Parse "Estimated arrival: X business day" from PayPal emails
- [x] Automatic hourly email scanning trigger (v1.5.1)
- [x] Fix PayPal transfer estimated arrival parsing (v1.5.2)
- [x] DA payout cooldown timer — 72h countdown with color coding (v1.5.3)
- [x] Auto-refresh pipeline every 60 seconds (v1.5.4)
- [x] Cross-repo cruise goal sync with cruise-payment-tracker (v1.5.5)
- [x] CruisePayments tab for cross-app sync (v1.5.6)
- [x] Comma thousands separator formatting throughout (v1.5.7)
- [x] Payout countdown timer in work sessions table (v1.5.8)
- [x] Sortable columns and filter dropdown on sessions table (v1.5.9)
- [x] Fix payout column sorting to use actual remaining time (v1.5.10)
- [x] Fix dropdown option styling for dark/light modes (v1.5.11)

## Earlier Features (COMPLETED)
- [x] Pipeline stage rename and payout hours update (v1.4.0–v1.4.1)
- [x] Dashboard "Total Amount to be Paid" shows earnings minus In Bank (v1.3.0)
- [x] Tax card label shows configured rate dynamically (v1.3.2)
- [x] Goal emoji icon picker (v1.3.0)
- [x] Fast modal/delete feedback (v1.3.0–v1.4.0)
- [x] Double-submit prevention on all forms (v1.3.0)
- [x] Fix camelCase for PascalCase headers like ProjectID/ID
- [x] Deploy Apps Script with EstimatedArrival parsing, clearEmailPayouts utility
