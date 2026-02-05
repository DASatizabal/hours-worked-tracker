# Hours Worked Tracker - TODO

## Priority: Deploy & Verify (USER ACTION NEEDED)
- [x] Deploy updated camelCase function to Apps Script editor & redeploy — confirmed deployed
- [ ] Verify Google Sheets sync end-to-end — all fields (ID, ProjectID) write correctly
- [ ] Clean up old manually-entered data — remove test entries, verify all have IDs

## Testing: New Form (USER ACTION NEEDED)
- [ ] Test Project work type — amount + hours/min + auto hourly rate calculation
- [ ] Test Task work type — only Amount Paid shows, no time fields
- [ ] Test edit/delete sessions — pre-fill works, delete removes from app + sheet

## Dashboard Fix
- [x] Change "This Week's Earnings" to "Total Amount to be Paid" — shows total earnings minus payments in "In Bank" status (v1.3.0)
- [x] Tax card label now dynamically shows configured tax rate instead of hardcoded "35%" (v1.3.2)

## Payment Pipeline (USER ACTION NEEDED)
- [ ] Test Payment Pipeline — currently everything is showing $0
  - NOTE: `parseFloat()` fix applied in v1.3.1. If pipeline still shows $0, the camelCase fix may not be deployed yet. Deploy the camelCase fix first, then test.
- [ ] Verify dashboard math — earnings, hours, tax totals are accurate
- [ ] Test payment pipeline with new session format (Project + Task types)

## Goal Icon Picker
- [x] Change "New Goal" icon input — popup grid of 48 common emoji icons (v1.3.0)

## Performance / UX Issues
- [x] Speed up screen updates — modals now close immediately before async operations (v1.3.0)
- [x] Fix double-submit bug — all form submit buttons now disable during async operations with "Saving..." feedback (v1.3.0)
- [x] Fix double-allocate bug — same double-click prevention applied to allocate form (v1.3.0)
- [x] Fix slow delete — goal delete now uses `Promise.all()` for parallel allocation deletion + "Deleting..." toast (v1.3.1)
- [x] Fix pipeline $0 display — added `parseFloat()` to payment amounts in pipeline rendering (v1.3.1)
- [x] Fix edit session modal — now awaits form population so correct work type shows immediately (v1.3.2)
- [x] Reference repo `/alex-expense-tracker` — uses similar static site architecture. Key UX patterns: immediate modal close, button state management during async ops. Already applied these patterns.

## Cross-Repo Integration (NEEDS USER INPUT)
- [ ] Sync "November Cruise" goal with David's info in `/cruise-payment-tracker`
  - **Findings:** Cruise tracker is at `dasatizabal.github.io/cruise-payment-tracker/`
  - David's share: $2,355.44 for Nov 20, 2026 cruise
  - Data stored in localStorage key `cruise-payments` (same GitHub Pages domain = shared localStorage!)
  - **Proposed approach:** Hours-worked-tracker can READ the `cruise-payments` localStorage key to auto-sync David's payment progress into a "November Cruise" savings goal
  - **Needs decision:** Should this be automatic (read cruise data on load) or manual (button to sync)?
