# Claude Code Handoff Prompt

> **START OF SESSION**: Read this file before proceeding. Also read SETUP.md for additional context.

## CRITICAL: Version Bump Required for EVERY Change
**EVERY commit MUST include a version bump. No exceptions.**
- Patch bump (x.y.Z) for bug fixes
- Minor bump (x.Y.0) for new features
- Update version in: `js/config.js` (`APP_VERSION`), `.claude/handoff.md`
- See "Version Bump Protocol" section below for full details

## What We're Building
Hours Worked Tracker - a PWA for tracking DataAnnotation work hours, earnings, taxes (35%), payment pipeline, and savings goals. Features a dark glassmorphism UI and syncs with Google Sheets via Apps Script. Single-user personal tool.

## Current State
**Version 1.0.0** - Initial release with all core features.

Working features:
- **Work session logging** - Duration or start/end time entry, project/task type, configurable hourly rate
- **Tax dashboard** - 35% tax set-aside, weekly/all-time gross/tax/net breakdowns, avg $/week stat
- **Payment pipeline** - 5-stage visual pipeline (Submitted -> Pending Payout -> Paid Out -> Transferring -> In Bank) with auto-advance timers and countdown displays
- **Savings goals** - Progress bars, hours-to-goal calculations, fund allocation from payments
- **Email integration** - Gmail scanning for DA payout + PayPal receipt emails with auto-matching to pipeline payments
- **Google Sheets sync** - 6-tab architecture (WorkSessions, Payments, Goals, GoalAllocations, EmailPayouts, Settings) with localStorage fallback
- **Firebase Auth** - Google OAuth sign-in with offline skip option
- **PWA support** - Service worker for offline caching, installable
- **Dark/Light theme toggle** with localStorage persistence and system preference detection
- **CSV export** - Work sessions, payments, and tax summary
- **Toast notifications** and loading overlay
- **Settings modal** - Configurable hourly rate, tax rate, payout timelines, Apps Script URL

## Key Constraints
- **No frameworks** - Vanilla JavaScript, HTML, Tailwind CSS (CDN)
- **Google Sheets backend** - Apps Script deployed as public web app, 6-tab schema
- **USD only** - No currency conversion needed (personal DA earnings tracker)
- **English only** - No i18n (personal tool)
- **GitHub Pages** - Auto-deploys on git push

## Don't Touch
- **Apps Script CORS workaround** - Uses `Content-Type: text/plain` to avoid preflight requests
- **Pipeline timing constants** - 187 hours for projects, 72 hours for tasks, 3 business days for PayPal transfer (these match DataAnnotation's actual payout schedule)
- **Tax rate calculation** - 35% default matches estimated self-employment tax obligation

## File Structure
```
hours-worked-tracker/
├── index.html              # Single-page app (all UI)
├── manifest.json           # PWA manifest
├── sw.js                   # Service worker (offline caching)
├── google-apps-script.js   # Backend: 6-tab CRUD + Gmail email parsing
├── SETUP.md                # Google Sheets + Apps Script + Firebase setup guide
├── css/
│   └── styles.css          # Light mode overrides, pipeline colors, animations
├── js/
│   ├── config.js           # Firebase config, default settings, APP_VERSION
│   ├── firebase-auth.js    # Firebase Google OAuth
│   ├── sheets-api.js       # Multi-tab Google Sheets CRUD + localStorage fallback
│   ├── tax-calc.js         # Tax calculation engine (35% default)
│   ├── pipeline.js         # Payment pipeline state machine + visualization
│   ├── goals.js            # Savings goal management + progress calculations
│   └── app.js              # Main app logic, UI rendering, event handlers
├── icons/
│   ├── icon-192.svg        # App icon 192x192
│   ├── icon-512.svg        # App icon 512x512
│   └── icon-maskable.svg   # Maskable icon for Android
└── .claude/
    └── handoff.md          # This file
```

## How to Run
**Option 1: Local only (current default)**
- Open `index.html` in browser
- Data saves to localStorage
- `CONFIG.USE_LOCAL_STORAGE` is `true` by default

**Option 2: Cloud sync**
- Set up Firebase project (see SETUP.md)
- Set up Google Sheet with 6 tabs and deploy Apps Script
- Paste Apps Script URL in Settings modal or `config.js`
- Set `CONFIG.USE_LOCAL_STORAGE` to `false`

**To deploy changes:**
- Bump version per the **Version Bump Protocol** below
```bash
git add .
git commit -m "Description of changes"
git push
```
GitHub Pages auto-deploys within 1-2 minutes.

## Data Models
- **WorkSession**: date, startTime, endTime, duration, type (project/task), projectId, hourlyRate, earnings
- **Payment**: amount, tax, netAmount, type, status (5 stages), timing fields, DA/PayPal IDs
- **SavingsGoal**: name, icon (emoji), targetAmount, savedAmount
- **GoalAllocation**: goalId, paymentId, amount, date
- **EmailPayout**: source (da/paypal), daPaymentId, amount, paypalTransactionId, matched

## Payment Pipeline Stages
| Stage | Trigger | Timing |
|-------|---------|--------|
| submitted | User creates payment | - |
| pending_payout | Auto: payoutExpectedAt reached | +187h (project) or +72h (task) |
| paid_out | DA payout email detected | - |
| transferring | Manual or auto | - |
| in_bank | PayPal receipt email detected | +3 business days after paid_out |

## Version Bump Protocol (IMPORTANT)
**Every commit & push MUST include a version bump.** Follow these steps:
1. Bump the patch version in `js/config.js` (`APP_VERSION` constant) - e.g., 1.0.0 -> 1.0.1
2. Update the version in `.claude/handoff.md` "Current State" section to match
3. Include the version bump in the same commit
4. Use **patch** bumps (x.y.Z) for bug fixes, **minor** bumps (x.Y.0) for new features

## Session End Protocol
When user says "I'm done for now":
1. Commit all changes with descriptive message
2. Push to GitHub (triggers deployment)
3. Verify live site updated if needed

## Quick Reference
**Add a work session:** Click "Log Work Session" button or call from console
**Create a payment:** Click pipeline Details > use session checkboxes
**Create a goal:** Click "New Goal" in Savings Goals section
**Scan emails:** Click "Scan Emails" (requires Apps Script deployment)
**Export data:** Settings modal > Export Data section
**Change settings:** Click gear icon in top bar

## Resources
- **Live Site**: https://dasatizabal.github.io/hours-worked-tracker/
- **GitHub**: https://github.com/DASatizabal/hours-worked-tracker
