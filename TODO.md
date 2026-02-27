# Hours Worked Tracker - TODO

## Open Items
_No open items._

## DA Scraper Setup Instructions

### David's setup
1. `tools/.env` with DA_EMAIL, DA_PASSWORD, APPS_SCRIPT_URL, GMAIL_APP_PASSWORD
2. Task Scheduler: "DA Payment Scrape" — daily, runs `run_scraper.bat`
3. Task Scheduler: "DA Get Paid" — daily at noon, runs `run_get_paid.bat` (payday check in script)

### Lisa's setup
1. `tools/.env.lisa` with DA_EMAIL, DA_PASSWORD, DA_USER_EMAIL, APPS_SCRIPT_URL, EMAIL_PROVIDER=gmail, IMAP_EMAIL, GMAIL_APP_PASSWORD
2. Gmailify links Yahoo (`Lisa_Blackford@yahoo.com`) to Gmail (`Lisasatizabal@gmail.com`)
3. Lisa deploys her own Apps Script (same SHEET_ID, runs as her account for GmailApp)
4. Task Scheduler: "DA Scrape - Lisa" — daily 8:30 AM, runs `run_scraper_lisa.bat`
5. Task Scheduler: "DA Get Paid - Lisa" — daily noon, runs `run_get_paid_lisa.bat` (payday check in script)

### Manual usage
```
python tools/da_scraper.py              # Full flow: scrape + auto-import
python tools/da_scraper.py --force      # Run regardless of payday
python tools/da_scraper.py --html-only  # Just save HTML, skip import
python tools/da_scraper.py --show-paid  # Include already-paid entries
python tools/da_scraper.py --auto       # Unattended: headless, no prompts
python tools/da_scraper.py --get-paid --auto  # Claim payment (headless)
python tools/da_scraper.py --profile lisa     # Use Lisa's profile
```

Logs are saved to `tools/logs/`.

## v2.0.x Features (COMPLETED)
- [x] Multi-user support with UserEmail column on data tabs (v2.0.0)
- [x] Family view toggle — personal/family mode with user badges (v2.0.0)
- [x] SCCU deposit email scanning for Lisa's bank (v2.0.0)
- [x] Per-user localStorage prefixes for cache isolation (v2.0.0)
- [x] Python scraper --profile flag for multi-user (.env.lisa) (v2.0.0)
- [x] Pass userEmail from frontend to scanEmails — Session API returns empty in web apps (v2.0.1)
- [x] IMAP_EMAIL env var for Gmailify — IMAP login differs from DA_EMAIL (v2.0.2)
- [x] Fix false offline status when remote returns empty for new users (v2.0.3)
- [x] Parallelize all API calls on page load — 30s → 5s load time (v2.0.4)

## v1.9.x Features (COMPLETED)
- [x] Dedup utilities to flag and remove duplicate WorkSessions (v1.9.0)
- [x] Expose dedup utilities via HTTP and return structured JSON (v1.9.1)
- [x] Round hourlyRate to whole dollars, duration to 2dp, fix dedup matching (v1.9.2)
- [x] Diagnostic logging in scanEmails for future debugging (v1.9.3)

## v1.8.x Features (COMPLETED)
- [x] Automated weekly DA scraper with payday-aware scheduling (v1.8.0)
- [x] Full browser auto-import: scrape → parse → apply corrections → add new entries
- [x] Payday setting synced to Google Sheets for scraper access
- [x] Apps Script upsertSetting endpoint for key/value settings

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

## v1.6.x and Earlier (COMPLETED)
- [x] Est. Next Paycheck card with configurable payout day (v1.6.0–v1.6.1)
- [x] Pipeline overhaul with EmailPayouts-based tracking (v1.5.0–v1.5.11)
- [x] Pipeline stage rename and payout hours update (v1.4.0–v1.4.1)
- [x] Dashboard, goals, tax calc, modal/delete improvements (v1.3.0–v1.3.2)
- [x] camelCase fix, Apps Script EstimatedArrival parsing
