# Hours Worked Tracker - TODO

## Priority: Deploy & Verify (USER ACTION NEEDED)
- [x] Deploy updated camelCase function to Apps Script editor & redeploy — confirmed deployed
- [x] Verify Google Sheets sync end-to-end — ID and ProjectID columns working (Test 1 passed)
- [ ] **Deploy v1.4.0 google-apps-script.js to Apps Script editor & redeploy** (NEW)
  - Adds PayPal transfer email scanning
  - Auto-creates payments from DA payout emails
  - Fixes PayPal receipt email behavior
- [ ] Clean up old manually-entered data — remove test entries, verify all have IDs

## Testing: New Form (USER ACTION NEEDED)
- [x] Test Project work type — amount + hours/min + auto hourly rate calculation (Test 2 passed)
- [x] Test Task work type — only Amount Paid shows, no time fields (Test 2 passed)
- [ ] Test edit/delete sessions — pre-fill works, delete removes from app + sheet
  - [x] Fixed: Edit modal now opens immediately with "Loading..." button (v1.4.0)
  - [x] Fixed: Delete row fades immediately with "Deleting..." toast (v1.4.0)

## Dashboard Fix
- [x] Change "This Week's Earnings" to "Total Amount to be Paid" — shows total earnings minus payments in "In Bank" status (v1.3.0)
- [x] Tax card label now dynamically shows configured tax rate instead of hardcoded "35%" (v1.3.2)
- [x] Dashboard math verified accurate (Test 5 passed)

## Payment Pipeline
- [x] Fix pipeline $0 display — added `parseFloat()` to payment amounts in pipeline rendering (v1.3.1)
- [x] Auto-create payment records from DA payout emails when pipeline is empty (v1.4.0)
- [x] Add PayPal "Your transfer request is processing" email scanning → advances to `transferring` (v1.4.0)
- [x] Fix PayPal "You have a new payout!" behavior — now only adds transaction ID, doesn't wrongly advance to in_bank (v1.4.0)
- [ ] Test payment pipeline after deploying v1.4.0 Apps Script

## Goal Icon Picker
- [x] Change "New Goal" icon input — popup grid of 48 common emoji icons (v1.3.0)

## Performance / UX Issues
- [x] Speed up screen updates — modals now close immediately before async operations (v1.3.0)
- [x] Fix double-submit bug — all form submit buttons now disable during async operations with "Saving..." feedback (v1.3.0)
- [x] Fix double-allocate bug — same double-click prevention applied to allocate form (v1.3.0)
- [x] Fix slow delete — goal delete now uses `Promise.all()` for parallel allocation deletion + "Deleting..." toast (v1.3.1)
- [x] Fix edit session modal — now opens immediately with "Loading..." on button (v1.4.0)
- [x] Fix delete session feedback — row fades + "Deleting..." toast shows immediately (v1.4.0)
- [x] Reference repo `/alex-expense-tracker` — patterns applied

## Cross-Repo Integration (NEEDS USER INPUT)
- [ ] Sync "November Cruise" goal with David's info in `/cruise-payment-tracker`
  - **Findings:** Cruise tracker is at `dasatizabal.github.io/cruise-payment-tracker/`
  - David's share: $2,355.44 for Nov 20, 2026 cruise
  - Data stored in localStorage key `cruise-payments` (same GitHub Pages domain = shared localStorage!)
  - **Proposed approach:** Hours-worked-tracker can READ the `cruise-payments` localStorage key to auto-sync David's payment progress into a "November Cruise" savings goal
  - **Needs decision:** Should this be automatic (read cruise data on load) or manual (button to sync)?
