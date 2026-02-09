# Hours Worked Tracker - Setup Guide
**Current Version: v1.7.3**

## 1. Firebase Setup (Google Sign-In)

1. Go to [Firebase Console](https://console.firebase.google.com)
2. Click **Add Project** > Name it `hours-worked-tracker`
3. Go to **Authentication** > **Sign-in method** > Enable **Google**
4. Go to **Project Settings** > **Your apps** > Click **Web** (</>) icon
5. Register app, copy the `firebaseConfig` values
6. Paste into `js/config.js` under `FIREBASE_CONFIG`
7. In **Authentication** > **Settings** > **Authorized domains**, add your domain (e.g., `your-username.github.io`)

## 2. Google Sheets Setup

1. Create a new Google Sheet
2. Copy the Sheet ID from the URL: `https://docs.google.com/spreadsheets/d/YOUR_SHEET_ID_HERE/edit`
3. The sheet needs **5 tabs**. You can create them manually or use the Apps Script `initializeTabs()` function:

### Tab Headers

| Tab | Headers |
|-----|---------|
| **WorkSessions** | Date, Duration, Type, ProjectID, Notes, HourlyRate, Earnings, SubmittedAt, ID |
| **Goals** | Name, Icon, TargetAmount, SavedAmount, CreatedAt, CompletedAt, ID |
| **GoalAllocations** | GoalId, PaymentId, Amount, Date, Notes, ID |
| **EmailPayouts** | Source, DAPaymentId, Amount, ReceivedAt, PaypalTransactionId, EstimatedArrival, ID |
| **Settings** | Key, Value |

## 3. Google Apps Script Deployment

1. In your Google Sheet, go to **Extensions** > **Apps Script**
2. Delete any existing code
3. Copy the entire contents of `google-apps-script.js` and paste it
4. **Replace** `YOUR_SHEET_ID_HERE` with your actual Sheet ID
5. Click **Run** > Select `initializeTabs` > **Run** (this creates all 6 tabs with headers)
6. Click **Run** > Select `testSetup` > **Run** (verify everything is working)
7. Click **Deploy** > **New deployment**
8. Set type: **Web app**
9. Set **Execute as**: Your account
10. Set **Who has access**: **Anyone**
11. Click **Deploy** and copy the Web app URL

### Paste the URL

In `js/config.js`, update:
```js
APPS_SCRIPT_URL: 'https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec'
```

Or paste it in the app's **Settings** modal.

## 4. Email Scanning (Optional)

The email scanner looks for:
- **DataAnnotation payout emails** from `noreply@mail.dataannotation.tech` with subject "New Payout!"
- **PayPal transfer emails** from `service@paypal.com` with subject "Your transfer request is processing"

This uses Gmail's native `GmailApp.search()` in Apps Script - no extra API setup needed. The Apps Script runs under your Google account, which already has Gmail access.

### How it works
1. Click **Scan Emails** in the app (or let the automatic trigger run hourly)
2. The Apps Script searches your Gmail for DA/PayPal emails (last 30 days)
3. It parses amounts and estimated arrival dates
4. It saves them to the **EmailPayouts** tab
5. The pipeline calculates totals based on these email records

### Pipeline Calculation
- **Submitted** = work sessions where payout time hasn't elapsed (7d for projects, 3d for tasks)
- **Available for Payout** = sessions past waiting time minus DA payout totals
- **In PayPal** = DA payout totals minus PayPal transfer totals
- **Transferring** = PayPal transfers where estimated arrival > now
- **In Bank** = PayPal transfers where estimated arrival <= now

### Enable Automatic Scanning (Recommended)
To have emails scanned automatically every hour:
1. In Apps Script, click **Run** > Select `setupEmailTrigger` > **Run**
2. Authorize the trigger when prompted
3. Emails will now be scanned hourly without manual intervention

To disable: Run `removeEmailTriggers` in Apps Script.

## 5. Update Auth Roles

In `js/config.js`, update `AUTH_ROLES` with your email:
```js
const AUTH_ROLES = {
    PRIMARY_USER: 'your-email@gmail.com',
    ADMINS: ['your-email@gmail.com']
};
```

## 6. Hosting

### GitHub Pages
1. Push to a GitHub repository
2. Go to **Settings** > **Pages** > Set source to `main` branch
3. Update `manifest.json` `start_url` and `scope` to match your repo path

### Local Development
Just open `index.html` in a browser. The app works offline with localStorage.

## 7. Configuration

### Default Settings (in `js/config.js`)
| Setting | Default | Description |
|---------|---------|-------------|
| `DEFAULT_HOURLY_RATE` | $20/hr | Used for new work sessions |
| `DEFAULT_TAX_RATE` | 0.35 (35%) | Tax set-aside percentage |
| `PROJECT_PAYOUT_HOURS` | 187 | Hours until project payout (7d 19h) |
| `TASK_PAYOUT_HOURS` | 72 | Hours until task payout (3d) |
| `PAYPAL_TRANSFER_BUSINESS_DAYS` | 3 | Business days for PayPal transfer |

All settings can be changed in the app's **Settings** modal.

## Verification Checklist

- [X] Firebase project created, Google Auth enabled
- [X] Google Sheet created with 5 tabs
- [X] Apps Script deployed, URL pasted into config/settings
- [ ] Sign in works (Google popup)
- [ ] Log a work session -> appears in dashboard and table
- [ ] Tax calculations: $100 earnings -> $35 tax, $65 net shown
- [ ] Create a payment -> appears in pipeline as "Submitted"
- [ ] Create a savings goal -> card shows with progress bar
- [ ] Allocate funds to goal -> progress updates
- [ ] Email scan (requires real DA/PayPal emails)
- [ ] Offline mode works (disconnect network)
- [ ] Theme toggle works (dark/light)
