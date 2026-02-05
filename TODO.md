# Hours Worked Tracker - TODO

## Priority: Deploy & Verify
- [ ] Deploy updated camelCase function to Apps Script editor & redeploy (New version)
- [ ] Verify Google Sheets sync end-to-end — all fields (ID, ProjectID) write correctly
- [ ] Clean up old manually-entered data — remove test entries, verify all have IDs

## Testing: New Form
- [ ] Test Project work type — amount + hours/min + auto hourly rate calculation
- [ ] Test Task work type — only Amount Paid shows, no time fields
- [ ] Test edit/delete sessions — pre-fill works, delete removes from app + sheet

## Dashboard Fix
- [ ] Change "This Week's Earnings" to "Total Amount to be Paid" — show total of all money that has NOT made it to "In Bank" status

## Payment Pipeline
- [ ] Test Payment Pipeline — currently everything is showing $0
- [ ] Verify dashboard math — earnings, hours, tax totals are accurate
- [ ] Test payment pipeline with new session format (Project + Task types)

## Goal Icon Picker
- [ ] Change "New Goal" icon input — when clicked, show a popup grid of icons to choose from (nobody has a keyboard full of emojis or knows how to type one)

## Performance / UX Issues
- [ ] Speed up screen updates and closing screens when buttons are clicked
- [ ] Fix double-submit bug — created a goal, clicked "Create Goal", nothing happened, clicked again, two duplicate goals were created
- [ ] Fix slow delete — clicked delete on a goal, took a while, no feedback
- [ ] Fix double-allocate bug — clicked "Allocate Funds", took a while, clicked again, 2 payments were allocated
- [ ] Reference repo `/alex-expense-tracker` to see how it handles fast UI updates with minimal lag

## Cross-Repo Integration
- [ ] Sync "November Cruise" goal with David's information in repo `/cruise-payment-tracker`
