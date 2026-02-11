# Hours Worked Tracker - TODO

## Open Items (USER ACTION NEEDED)
- [ ] **Deploy v1.8.0 google-apps-script.js** — upsertSetting endpoint for payday sync
- [ ] **Set up tools/.env** — copy from .env.example, fill in DA credentials + Apps Script URL
- [ ] **Save payday setting** — open Settings in the app and click Save to push payday to Google Sheets
- [ ] **Install Python dependencies** — `pip install playwright python-dotenv requests && playwright install chromium`
- [ ] **Set up Windows Task Scheduler** — daily trigger (see setup instructions below)

## DA Scraper Setup Instructions

### 1. Deploy Apps Script
Copy the updated `google-apps-script.js` into your Apps Script editor and redeploy.

### 2. Create `tools/.env`
Copy from `.env.example` and fill in your credentials:
```
DA_EMAIL=your_email@example.com
DA_PASSWORD=your_password
APPS_SCRIPT_URL=https://script.google.com/macros/s/AKfycbw.../exec
```

### 3. Install Python dependencies
```
pip install playwright python-dotenv requests
playwright install chromium
```

### 4. Save payday in the app
Open Settings in the tracker app and click Save. This pushes the payday weekday to Google Sheets so the scraper can read it.

### 5. Set up Windows Task Scheduler
1. Open Task Scheduler > Create Basic Task
2. Name: "DA Payment Scrape"
3. Trigger: **Daily**, pick a morning time (e.g., 8:00 AM)
4. Action: Start a Program
   - Program: `python`
   - Arguments: `"L:\David's Folder\Claude Projects\hours-worked-tracker\tools\da_scraper.py" --auto`
   - Start in: `"L:\David's Folder\Claude Projects\hours-worked-tracker\tools"`

The script runs daily but checks Google Sheets for your payday setting. On non-payday it exits immediately. On payday it scrapes DA, auto-imports into the tracker, and saves an HTML backup to `tools/da_html_exports/`.

### Manual usage
```
python tools/da_scraper.py              # Full flow: scrape + auto-import (checks payday)
python tools/da_scraper.py --force      # Run regardless of payday
python tools/da_scraper.py --html-only  # Just save HTML, skip import
python tools/da_scraper.py --show-paid  # Include already-paid entries
python tools/da_scraper.py --auto       # Unattended: headless, no prompts
```

Logs are saved to `tools/logs/`.

## v1.8.x Features (COMPLETED)
- [x] Automated weekly DA scraper with payday-aware scheduling (v1.8.0)
- [x] Full browser auto-import: scrape → parse → apply corrections → add new entries
- [x] Payday setting synced to Google Sheets for scraper access
- [x] Apps Script upsertSetting endpoint for key/value settings

## Completed Housekeeping
- [x] Deploy v1.7.8 google-apps-script.js — Chase deposit scanning, version bump
- [x] Update Google Sheet tabs — removed StartTime/EndTime columns and Payments tab
- [x] Clean up old manually-entered data — removed test entries, verified IDs
- [x] Test edit/delete sessions — pre-fill and sheet deletion verified

## v1.7.x Features (COMPLETED)
- [x] DA HTML import to reconcile work sessions and correct submittedAt timestamps (v1.7.0)
- [x] Widen DA import matching window from 1 day to 3 days (v1.7.1)
- [x] Option to import unmatched DA entries as new sessions (v1.7.2)
- [x] Set projectId to DA project name when importing new entries (v1.7.3)
- [x] Fix DA parser to detect tw-ml-5 project name headers (v1.7.4)
- [x] Smart polling to auto-sync when server email scan finds new data (v1.7.5)
- [x] Fix Est. Next Paycheck to exclude already-paid-out amounts (v1.7.6)
- [x] Estimated arrival date under Transferring pipeline stage (v1.7.7)
- [x] Chase deposit email scanning to confirm bank arrivals (v1.7.8)

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
