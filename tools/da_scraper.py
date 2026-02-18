"""
DA Payment Scraper & Auto-Importer
===================================
Logs into DataAnnotation Tech, expands all payment rows,
extracts the HTML, parses entries, and imports them directly
into Google Sheets via the Apps Script API for automatic reconciliation.

Setup:
    pip install playwright python-dotenv requests beautifulsoup4
    playwright install chromium

Usage:
    python da_scraper.py              # Full flow: scrape + import into tracker
    python da_scraper.py --html-only  # Just save HTML to file, skip tracker import
    python da_scraper.py --show-paid  # Also include already-paid entries
    python da_scraper.py --force      # Run regardless of payday setting
    python da_scraper.py --auto       # Unattended mode (headless, no prompts)
    python da_scraper.py --get-paid        # Request payout (payday check applies)
    python da_scraper.py --get-paid --force # Request payout regardless of day
    python da_scraper.py --get-paid --auto  # Headless payout for Task Scheduler

Credentials:
    Create a .env file in the tools/ directory:
        DA_EMAIL=your_email@example.com
        DA_PASSWORD=your_password
        APPS_SCRIPT_URL=https://script.google.com/macros/s/YOUR_ID/exec

Scheduling (Windows Task Scheduler):
    The script checks payday from Google Sheets and exits early if
    today isn't the configured payday. Schedule two daily tasks:

    1. Scraper task (morning):
       Open Task Scheduler > Create Basic Task
       Trigger: Daily, pick your morning time
       Action: Start a Program
       Program: python
       Arguments: "L:\\David's Folder\\Claude Projects\\hours-worked-tracker\\tools\\da_scraper.py" --auto
       Start in: "L:\\David's Folder\\Claude Projects\\hours-worked-tracker\\tools"

    2. Get-paid task (noon):
       Same setup but with Arguments:
       "L:\\David's Folder\\Claude Projects\\hours-worked-tracker\\tools\\da_scraper.py" --get-paid --auto
       Trigger at noon so the scraper has already run and earnings are recorded.
"""

import os
import sys
import json
import re
import time
import imaplib
import email as email_lib
import argparse
import logging
from pathlib import Path
from datetime import datetime, timezone, timedelta
import requests
from bs4 import BeautifulSoup
from dotenv import load_dotenv
from playwright.sync_api import sync_playwright, TimeoutError as PWTimeout

# Load .env from the tools/ directory
SCRIPT_DIR = Path(__file__).parent
load_dotenv(SCRIPT_DIR / '.env')

DA_EMAIL = os.getenv("DA_EMAIL")
DA_PASSWORD = os.getenv("DA_PASSWORD")
GMAIL_APP_PASSWORD = os.getenv("GMAIL_APP_PASSWORD", "")
APPS_SCRIPT_URL = os.getenv("APPS_SCRIPT_URL", "")
DA_PAYMENTS_URL = "https://app.dataannotation.tech/workers/payments"
HTML_OUTPUT_DIR = SCRIPT_DIR / "da_html_exports"

# Logging
LOG_DIR = SCRIPT_DIR / "logs"
LOG_DIR.mkdir(exist_ok=True)
log_file = LOG_DIR / f"scraper_{datetime.now().strftime('%Y-%m-%d')}.log"
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
    handlers=[logging.StreamHandler(), logging.FileHandler(log_file)]
)
log = logging.getLogger(__name__)

# Day name mapping (matches JS: 0=Sunday, 1=Monday, ... 6=Saturday)
DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
DEFAULT_PAYOUT_WEEKDAY = 2  # Tuesday


def get_payday_from_sheets():
    """Read the payoutWeekday setting from Google Sheets via Apps Script."""
    if not APPS_SCRIPT_URL:
        log.warning("APPS_SCRIPT_URL not set in .env, using default payday (Tuesday)")
        return DEFAULT_PAYOUT_WEEKDAY

    try:
        url = APPS_SCRIPT_URL + '?tab=Settings'
        response = requests.get(url, timeout=15, allow_redirects=True)
        data = response.json()
        records = data.get('records', [])
        for r in records:
            if r.get('key') == 'payoutWeekday':
                day = int(r['value'])
                log.info(f"Payday from Google Sheets: {DAY_NAMES[day]} ({day})")
                return day
    except Exception as e:
        log.warning(f"Could not read payday from Sheets: {e}")

    log.info(f"No payday setting found, using default: {DAY_NAMES[DEFAULT_PAYOUT_WEEKDAY]}")
    return DEFAULT_PAYOUT_WEEKDAY


def is_today_payday(payday_weekday):
    """Check if today matches the configured payday.
    Python weekday: Monday=0 ... Sunday=6
    JS weekday: Sunday=0 ... Saturday=6
    """
    today_py = datetime.now().weekday()  # Monday=0
    # Convert Python weekday to JS weekday
    today_js = (today_py + 1) % 7  # Sunday=0
    return today_js == payday_weekday


def fetch_verification_code_from_gmail(max_retries=5, retry_delay=5):
    """Fetch a verification code from Gmail via IMAP.

    Searches recent emails from DataAnnotation for a numeric verification code.
    Retries several times since the email may take a few seconds to arrive.
    """
    if not GMAIL_APP_PASSWORD:
        log.error("GMAIL_APP_PASSWORD not set in .env — cannot fetch verification code.")
        return None

    sender_patterns = ["dataannotation", "noreply@"]
    code_pattern = re.compile(r'\b(\d{6})\b')

    for attempt in range(1, max_retries + 1):
        log.info(f"  -> Checking Gmail for verification code (attempt {attempt}/{max_retries})...")
        try:
            mail = imaplib.IMAP4_SSL("imap.gmail.com", 993)
            mail.login(DA_EMAIL, GMAIL_APP_PASSWORD)
            mail.select("INBOX")

            # Search for recent emails (last 2 minutes)
            since_date = (datetime.now() - timedelta(minutes=5)).strftime("%d-%b-%Y")
            _, msg_ids = mail.search(None, f'(SINCE "{since_date}")')

            if not msg_ids[0]:
                log.info(f"     No recent emails found.")
                mail.logout()
                if attempt < max_retries:
                    time.sleep(retry_delay)
                continue

            # Check emails from newest to oldest
            id_list = msg_ids[0].split()
            for msg_id in reversed(id_list):
                _, msg_data = mail.fetch(msg_id, "(RFC822)")
                raw_email = msg_data[0][1]
                msg = email_lib.message_from_bytes(raw_email)

                # Check sender
                sender = (msg.get("From", "") or "").lower()
                subject = (msg.get("Subject", "") or "").lower()
                if not any(p in sender for p in sender_patterns) and "verification" not in subject and "code" not in subject:
                    continue

                # Check email date is within the last 3 minutes
                date_str = msg.get("Date", "")
                try:
                    msg_date = email_lib.utils.parsedate_to_datetime(date_str)
                    if msg_date.tzinfo is None:
                        msg_date = msg_date.replace(tzinfo=timezone.utc)
                    age = datetime.now(timezone.utc) - msg_date
                    if age > timedelta(minutes=5):
                        continue
                except Exception:
                    pass  # If we can't parse date, still try the email

                # Extract body text
                body = ""
                if msg.is_multipart():
                    for part in msg.walk():
                        content_type = part.get_content_type()
                        if content_type == "text/plain":
                            payload = part.get_payload(decode=True)
                            if payload:
                                body = payload.decode("utf-8", errors="replace")
                                break
                        elif content_type == "text/html" and not body:
                            payload = part.get_payload(decode=True)
                            if payload:
                                body = payload.decode("utf-8", errors="replace")
                else:
                    payload = msg.get_payload(decode=True)
                    if payload:
                        body = payload.decode("utf-8", errors="replace")

                # Search for 6-digit code in subject and body
                for text in [msg.get("Subject", ""), body]:
                    match = code_pattern.search(text)
                    if match:
                        code = match.group(1)
                        log.info(f"  -> Found verification code: {code}")
                        mail.logout()
                        return code

            mail.logout()

        except imaplib.IMAP4.error as e:
            log.error(f"  -> IMAP error: {e}")
            return None
        except Exception as e:
            log.warning(f"  -> Gmail fetch error: {e}")

        if attempt < max_retries:
            log.info(f"     Code not found yet, retrying in {retry_delay}s...")
            time.sleep(retry_delay)

    log.error("  -> Could not find verification code in Gmail after all retries.")
    return None


def login_to_da(page):
    """Navigate to DA and log in with email/password."""
    log.info("[1/6] Navigating to DA payments page...")
    page.goto(DA_PAYMENTS_URL, wait_until="domcontentloaded", timeout=30000)

    # If redirected to login, fill credentials
    if "login" in page.url.lower() or "sign" in page.url.lower():
        log.info("[2/6] Logging in...")
        email_field = page.locator('input[type="email"], input[name="email"], input[id*="email"]').first
        email_field.wait_for(state="visible", timeout=10000)
        email_field.fill(DA_EMAIL)

        password_field = page.locator('input[type="password"], input[name="password"]').first
        password_field.wait_for(state="visible", timeout=5000)
        password_field.fill(DA_PASSWORD)

        submit_btn = page.locator('button[type="submit"], input[type="submit"]').first
        submit_btn.click()

        # Wait a moment for the page to respond
        page.wait_for_timeout(3000)

        # Check if we landed on workers page or got a verification prompt
        if "/workers/" in page.url:
            log.info("  -> Login successful (no verification needed)!")
        else:
            # Look for a verification/OTP code input field
            code_input = page.locator(
                'input[type="text"][name*="code"], '
                'input[type="number"][name*="code"], '
                'input[type="tel"], '
                'input[name*="otp"], '
                'input[name*="verification"], '
                'input[placeholder*="code" i], '
                'input[placeholder*="verif" i], '
                'input[aria-label*="code" i], '
                'input[aria-label*="verif" i]'
            ).first

            try:
                code_input.wait_for(state="visible", timeout=5000)
                log.info("  -> Verification code prompt detected!")

                # Fetch the code from Gmail
                code = fetch_verification_code_from_gmail()
                if not code:
                    log.error("  -> Failed to get verification code. Cannot proceed.")
                    raise Exception("Verification code required but could not be fetched from Gmail.")

                # Enter the code
                code_input.fill(code)
                log.info(f"  -> Entered verification code.")

                # Submit the code
                verify_btn = page.locator('button[type="submit"], input[type="submit"]').first
                verify_btn.click()

                # Wait for redirect to workers page
                page.wait_for_url("**/workers/**", timeout=60000)
                log.info("  -> Login successful (with verification code)!")

            except PWTimeout:
                # No verification input found, or redirect took too long.
                # Check if we're already on /workers/
                if "/workers/" in page.url:
                    log.info("  -> Already on workers page, continuing.")
                else:
                    log.info("  -> No verification input found, waiting for redirect...")
                    try:
                        page.wait_for_url("**/workers/**", timeout=15000)
                        log.info("  -> Login successful!")
                    except PWTimeout:
                        raise Exception(
                            f"Login failed — stuck at {page.url}. "
                            "Not a verification prompt and not redirecting to /workers/."
                        )
    else:
        log.info("[2/6] Already logged in, skipping.")

    # Make sure we're on the payments page
    if "/workers/payments" not in page.url:
        page.goto(DA_PAYMENTS_URL, wait_until="domcontentloaded", timeout=30000)

    page.wait_for_timeout(2000)


def claim_payment(page):
    """Click the 'Get paid' button on the payments page to request payout."""
    log.info("[3/3] Looking for 'Get paid' button...")

    try:
        get_paid_btn = page.locator('button.btn.btn-primary', has_text='Get paid').first
        get_paid_btn.wait_for(state="visible", timeout=10000)

        btn_text = get_paid_btn.text_content().strip()
        log.info(f"  -> Found button: \"{btn_text}\"")

        get_paid_btn.click()
        log.info("  -> Clicked 'Get paid' button.")

        # Wait for the transfer-in-progress confirmation to appear
        try:
            page.locator('#transferInProgress').wait_for(state="visible", timeout=15000)
            log.info("  -> Transfer initiated! Confirmation element visible.")
        except PWTimeout:
            log.warning("  -> Transfer confirmation (#transferInProgress) did not appear within 15s.")

        # Take a screenshot for the record
        screenshot_path = str(SCRIPT_DIR / "da_payment_claimed.png")
        page.screenshot(path=screenshot_path)
        log.info(f"  -> Screenshot saved to da_payment_claimed.png")
        log.info("")
        log.info("=" * 55)
        log.info(f" PAYMENT CLAIMED: {btn_text}")
        log.info("=" * 55)

    except PWTimeout:
        log.info("  -> No 'Get paid' button found (may not have a balance to claim).")
        page.screenshot(path=str(SCRIPT_DIR / "da_payment_claimed.png"))
        log.info("  -> Screenshot saved to da_payment_claimed.png")


def ensure_view_all_tab(page):
    """Make sure the 'View All' tab is active so we see everything."""
    log.info("[3/6] Ensuring 'View All' tab is active...")
    try:
        view_all = page.locator('text="View All"').first
        if view_all.is_visible():
            view_all.click()
            page.wait_for_timeout(1000)
            log.info("  -> 'View All' tab selected.")
    except Exception:
        log.info("  -> Could not find 'View All' tab, continuing with current view.")


def toggle_show_paid(page, enable=False):
    """Check/uncheck the 'Show paid' checkbox."""
    if not enable:
        return
    log.info("  -> Enabling 'Show paid' checkbox...")
    try:
        checkbox = page.locator('input[type="checkbox"]').first
        if not checkbox.is_checked():
            checkbox.click()
            page.wait_for_timeout(2000)
            log.info("  -> 'Show paid' enabled.")
    except Exception:
        log.info("  -> Could not toggle 'Show paid' checkbox.")


def expand_all_rows(page):
    """Click all collapsed expand arrows to reveal nested rows."""
    log.info("[4/6] Expanding all nested rows...")
    total_expanded = 0
    max_rounds = 20

    for round_num in range(max_rounds):
        result = page.evaluate("""() => {
            const svgs = document.querySelectorAll('svg.tw-rounded-full');
            let clicked = 0;
            for (const svg of svgs) {
                // Skip arrows we've already expanded
                if (svg.dataset.expanded === '1') continue;
                const style = svg.getAttribute('style') || '';
                if (style.includes('rotate(-0.25turn)')) {
                    svg.dataset.expanded = '1';
                    svg.parentElement.click();
                    clicked++;
                }
            }
            return { clicked };
        }""")

        clicked = result["clicked"]
        total_expanded += clicked

        if clicked == 0:
            log.info(f"  -> Round {round_num + 1}: no more collapsed rows found")
            break

        log.info(f"  -> Round {round_num + 1}: expanded {clicked} rows")
        page.wait_for_timeout(800)

    log.info(f"  -> Total expansions: {total_expanded}")
    return total_expanded


def scrape_all_pages(page, show_paid=False):
    """Expand all rows on every page, handling pagination via the 'Next' button."""
    ensure_view_all_tab(page)
    toggle_show_paid(page, enable=show_paid)

    all_html_parts = []
    page_num = 1

    while True:
        log.info(f"\n--- Page {page_num} ---")
        expand_all_rows(page)

        table_html = page.evaluate("""() => {
            const table = document.querySelector('table');
            return table ? table.outerHTML : '';
        }""")
        if table_html:
            all_html_parts.append(table_html)

        try:
            next_btn = page.locator('button:has-text("Next")').first
            if next_btn.is_visible(timeout=2000) and next_btn.is_enabled():
                next_btn.click()
                page.wait_for_timeout(2000)
                page_num += 1
            else:
                break
        except Exception:
            break

    log.info(f"\n  -> Scraped {page_num} page(s) total")
    return all_html_parts


def combine_html_pages(html_parts):
    """Wrap multiple table pages into one HTML doc."""
    if len(html_parts) == 1:
        return f"<html><body>{html_parts[0]}</body></html>"

    combined = "<html><body>\n"
    for i, part in enumerate(html_parts):
        combined += f"<!-- Page {i + 1} -->\n{part}\n"
    combined += "</body></html>"
    return combined


def save_html_to_file(html):
    """Save HTML to a timestamped file for backup."""
    HTML_OUTPUT_DIR.mkdir(exist_ok=True)
    timestamp = datetime.now().strftime("%Y-%m-%d_%H%M%S")
    filepath = HTML_OUTPUT_DIR / f"da_payments_{timestamp}.html"
    filepath.write_text(html, encoding="utf-8")
    log.info(f"  -> Saved to {filepath}")
    return filepath


def parse_da_html(html):
    """Parse DA payments HTML and extract work entries.

    Replicates the JS parseDAHtml() logic using BeautifulSoup.
    Returns a list of dicts with: type, amount, duration, submittedAt, projectName
    """
    soup = BeautifulSoup(html, 'html.parser')
    rows = soup.select('tr[id^="row-"]')
    entries = []
    current_project = None

    for row in rows:
        row_class = row.get('class', [])
        row_class_str = ' '.join(row_class) if isinstance(row_class, list) else str(row_class)
        is_date_row = 'tw-bg-[#E5D3EB]' in row_class_str or 'tw-border-primary-light-50' in row_class_str

        # Check indent level to distinguish headers vs sub-items
        title_div = row.select_one('[data-column-id="title"] div div')
        title_div_class = ' '.join(title_div.get('class', [])) if title_div else ''
        is_sub_item = 'tw-ml-10' in title_div_class
        is_top_level = 'tw-ml-0' in title_div_class and not is_sub_item

        # Get title text
        title_span = row.select_one('[data-column-id="title"] span')
        title = title_span.get_text(strip=True) if title_span else ''

        # Get amount
        amount_cell = row.select_one('[data-column-id="amount"] > div')
        amount_text = amount_cell.get_text(strip=True) if amount_cell else ''
        try:
            amount = float(re.sub(r'[$,]', '', amount_text))
        except (ValueError, TypeError):
            amount = 0.0

        # Get time/duration text
        time_cell = row.select_one('[data-column-id="time"] > div')
        time_text = time_cell.get_text(strip=True) if time_cell else ''

        # Get submitted timestamp (epoch ms in datetime attr)
        time_el = row.select_one('[data-column-id="timeAgo"] time[datetime]')
        submitted_ms = None
        if time_el and time_el.get('datetime'):
            try:
                submitted_ms = int(time_el['datetime'])
            except (ValueError, TypeError):
                pass

        # Date rows are purple bg AND tw-ml-0 (top-level)
        if is_date_row and is_top_level:
            current_project = None
            continue

        # Project name headers are at tw-ml-5 (or tw-ml-0 without date bg)
        is_project_header = (is_top_level or 'tw-ml-5' in title_div_class) and not is_sub_item
        if is_project_header and title not in ('Task Submission', 'Time Entry'):
            current_project = title
            continue

        if not is_sub_item:
            continue

        # Parse sub-items
        if title == 'Time Entry' and amount > 0 and submitted_ms:
            # Project-type work (has duration)
            duration = 0.0
            h_match = re.search(r'(\d+)h', time_text)
            m_match = re.search(r'(\d+)min', time_text)
            if h_match:
                duration += int(h_match.group(1))
            if m_match:
                duration += int(m_match.group(1)) / 60.0

            submitted_dt = datetime.fromtimestamp(submitted_ms / 1000, tz=timezone.utc)
            entries.append({
                'type': 'project',
                'amount': round(amount, 2),
                'duration': round(duration, 2),
                'durationText': time_text,
                'submittedAt': submitted_dt.isoformat(),
                'submittedAtMs': submitted_ms,
                'projectName': current_project or ''
            })

        elif title == 'Task Submission' and amount > 0 and submitted_ms:
            # Task-type work (no duration)
            submitted_dt = datetime.fromtimestamp(submitted_ms / 1000, tz=timezone.utc)
            entries.append({
                'type': 'task',
                'amount': round(amount, 2),
                'duration': 0,
                'durationText': '',
                'submittedAt': submitted_dt.isoformat(),
                'submittedAtMs': submitted_ms,
                'projectName': current_project or ''
            })

    log.info(f"  -> Parsed {len(entries)} DA entries from HTML")
    return entries


def fetch_existing_sessions():
    """Fetch existing work sessions from Google Sheets via Apps Script."""
    if not APPS_SCRIPT_URL:
        log.error("APPS_SCRIPT_URL not set in .env — cannot fetch sessions.")
        return []

    try:
        url = APPS_SCRIPT_URL + '?tab=WorkSessions'
        response = requests.get(url, timeout=30, allow_redirects=True)
        data = response.json()
        records = data.get('records', [])
        log.info(f"  -> Fetched {len(records)} existing work sessions from Sheets")
        return records
    except Exception as e:
        log.error(f"  -> Failed to fetch sessions: {e}")
        return []


def reconcile_da_entries(da_entries, sessions):
    """Match DA entries against existing sessions.

    Replicates the JS reconcileDAData() logic:
    - Exact amount match (2 decimal places)
    - Same type (project/task)
    - Date within ±3 days
    - Pick closest timestamp match
    - Matched if timestamps within 5 minutes, otherwise correction needed
    """
    matched = []
    corrections = []
    unmatched = []
    used_session_ids = set()

    for da in da_entries:
        da_date = datetime.fromisoformat(da['submittedAt'])

        best_match = None
        best_time_diff = float('inf')

        for session in sessions:
            sid = session.get('id', '')
            if sid in used_session_ids:
                continue

            # Amount must match exactly (2 decimal places)
            try:
                s_earnings = round(float(session.get('earnings', 0)), 2)
            except (ValueError, TypeError):
                continue
            if s_earnings != da['amount']:
                continue

            # Type must match
            if session.get('type') != da['type']:
                continue

            # Date must be within 3 days
            session_submitted = session.get('submittedAt')
            session_date_str = session.get('date', '')
            if session_submitted:
                try:
                    session_dt = datetime.fromisoformat(session_submitted)
                except ValueError:
                    session_dt = datetime.fromisoformat(session_date_str) if session_date_str else None
            elif session_date_str:
                try:
                    session_dt = datetime.fromisoformat(session_date_str)
                except ValueError:
                    continue
            else:
                continue

            if session_dt is None:
                continue

            # Ensure both are offset-aware or offset-naive for comparison
            if da_date.tzinfo and not session_dt.tzinfo:
                session_dt = session_dt.replace(tzinfo=timezone.utc)
            elif not da_date.tzinfo and session_dt.tzinfo:
                da_date = da_date.replace(tzinfo=timezone.utc)

            time_diff = abs((da_date - session_dt).total_seconds())
            day_diff = time_diff / (60 * 60 * 24)

            if day_diff <= 3 and time_diff < best_time_diff:
                best_match = session
                best_time_diff = time_diff

        if best_match:
            used_session_ids.add(best_match['id'])
            old_submitted = best_match.get('submittedAt')
            if old_submitted:
                try:
                    old_dt = datetime.fromisoformat(old_submitted)
                    if da_date.tzinfo and not old_dt.tzinfo:
                        old_dt = old_dt.replace(tzinfo=timezone.utc)
                    time_diff_min = abs((da_date - old_dt).total_seconds()) / 60
                except ValueError:
                    time_diff_min = float('inf')
            else:
                time_diff_min = float('inf')

            if time_diff_min <= 5:
                matched.append({'da': da, 'session': best_match})
            else:
                corrections.append({
                    'da': da,
                    'session': best_match,
                    'oldSubmittedAt': old_submitted,
                    'newSubmittedAt': da['submittedAt']
                })
        else:
            unmatched.append({'da': da})

    log.info(f"  -> Reconciliation: {len(matched)} matched, {len(corrections)} corrections, {len(unmatched)} new")
    return {
        'matched': matched,
        'corrections': corrections,
        'unmatched': unmatched,
        'total': len(da_entries)
    }


def import_to_sheets(corrections, unmatched):
    """Push corrections and new entries to Google Sheets via Apps Script.

    - Corrections: update submittedAt (and optionally duration/notes)
    - New entries: add as new WorkSession records
    """
    if not APPS_SCRIPT_URL:
        log.error("APPS_SCRIPT_URL not set — cannot import to Sheets.")
        return

    if not corrections and not unmatched:
        log.info("[6/6] Nothing to import — all entries already matched.")
        return

    log.info(f"[6/6] Importing to Sheets: {len(corrections)} corrections, {len(unmatched)} new entries...")

    # Apply corrections
    for c in corrections:
        session = c['session']
        da = c['da']
        updates = {'submittedAt': c['newSubmittedAt']}

        # Also update duration if DA has it and session doesn't
        s_duration = float(session.get('duration', 0) or 0)
        if da['duration'] > 0 and s_duration == 0:
            updates['duration'] = da['duration']
            updates['hourlyRate'] = da['amount'] / da['duration']

        # Add project name to notes if session has no notes
        if da['projectName'] and not session.get('notes'):
            updates['notes'] = da['projectName']

        try:
            payload = json.dumps({
                'action': 'update',
                'tab': 'WorkSessions',
                'id': session['id'],
                'updates': updates
            })
            resp = requests.post(
                APPS_SCRIPT_URL,
                headers={'Content-Type': 'text/plain'},
                data=payload,
                timeout=30,
                allow_redirects=True
            )
            result = resp.json()
            if result.get('error'):
                log.error(f"  -> Correction failed for {session['id']}: {result['error']}")
            else:
                log.info(f"  -> Corrected {session['id']}: submittedAt -> {c['newSubmittedAt'][:19]}")
        except Exception as e:
            log.error(f"  -> Correction request failed for {session['id']}: {e}")

    # Add new entries
    for u in unmatched:
        da = u['da']
        record_id = f"ws_{int(time.time() * 1000)}_{os.urandom(4).hex()}"
        record = {
            'id': record_id,
            'date': da['submittedAt'][:10],
            'duration': da['duration'],
            'type': da['type'],
            'projectId': '',
            'notes': da['projectName'],
            'hourlyRate': da['amount'] / da['duration'] if da['duration'] > 0 else 0,
            'earnings': da['amount'],
            'submittedAt': da['submittedAt']
        }

        try:
            payload = json.dumps({
                'action': 'add',
                'tab': 'WorkSessions',
                'record': record
            })
            resp = requests.post(
                APPS_SCRIPT_URL,
                headers={'Content-Type': 'text/plain'},
                data=payload,
                timeout=30,
                allow_redirects=True
            )
            result = resp.json()
            if result.get('error'):
                log.error(f"  -> Add failed for {record_id}: {result['error']}")
            else:
                log.info(f"  -> Added {record_id}: ${da['amount']:.2f} {da['type']} on {da['submittedAt'][:10]}")
        except Exception as e:
            log.error(f"  -> Add request failed for {record_id}: {e}")

        # Small delay to avoid generating duplicate IDs
        time.sleep(0.05)


def main():
    parser = argparse.ArgumentParser(description="DA Payment Scraper & Auto-Importer")
    parser.add_argument("--html-only", action="store_true",
                        help="Only extract and save HTML, don't import into tracker")
    parser.add_argument("--headless", action="store_true",
                        help="Run without visible browser")
    parser.add_argument("--show-paid", action="store_true",
                        help="Include already-paid entries (check 'Show paid')")
    parser.add_argument("--force", action="store_true",
                        help="Run regardless of payday setting")
    parser.add_argument("--auto", action="store_true",
                        help="Unattended mode: headless, no prompts, skips non-payday")
    parser.add_argument("--get-paid", action="store_true",
                        help="Click the 'Get paid' button to request payout")
    args = parser.parse_args()

    # --auto implies --headless
    if args.auto:
        args.headless = True

    # Check payday unless --force is set
    if not args.force:
        payday = get_payday_from_sheets()
        if not is_today_payday(payday):
            log.info(f"Today is {DAY_NAMES[(datetime.now().weekday() + 1) % 7]}, "
                     f"payday is {DAY_NAMES[payday]}. Skipping. (Use --force to override)")
            sys.exit(0)
        if args.get_paid:
            log.info(f"Today is payday ({DAY_NAMES[payday]})! Starting payment claim...")
        else:
            log.info(f"Today is payday ({DAY_NAMES[payday]})! Starting scrape...")

    if not DA_EMAIL or not DA_PASSWORD:
        log.error("Missing credentials! Create a .env file with DA_EMAIL and DA_PASSWORD.")
        sys.exit(1)

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=args.headless)
        context = browser.new_context(
            viewport={"width": 1400, "height": 900},
            user_agent=(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/120.0.0.0 Safari/537.36"
            )
        )
        page = context.new_page()

        try:
            if args.get_paid:
                # --get-paid mode: login and claim payment, skip scraping
                login_to_da(page)
                claim_payment(page)
            else:
                # Normal mode: scrape + import
                # Steps 1-2: Login
                login_to_da(page)

                # Steps 3-4: Select tab, expand all rows, paginate
                html_parts = scrape_all_pages(page, show_paid=args.show_paid)
                combined_html = combine_html_pages(html_parts)

                # Step 5: Save backup
                saved_path = save_html_to_file(combined_html)

                if args.html_only:
                    log.info(f"\nDone! HTML saved to: {saved_path}")
                else:
                    # Step 6: Parse, reconcile, and import via API
                    da_entries = parse_da_html(combined_html)
                    sessions = fetch_existing_sessions()
                    result = reconcile_da_entries(da_entries, sessions)
                    import_to_sheets(result['corrections'], result['unmatched'])

                    log.info("")
                    log.info("=" * 55)
                    log.info(" DONE! Data reconciled via API.")
                    log.info(f" {result['total']} DA entries: {len(result['matched'])} matched, "
                             f"{len(result['corrections'])} corrected, {len(result['unmatched'])} new")
                    log.info(f" HTML backup: {saved_path}")
                    log.info("=" * 55)

        except Exception as e:
            log.error(f"ERROR: {e}")
            page.screenshot(path=str(SCRIPT_DIR / "da_scraper_error.png"))
            log.error("Screenshot saved to da_scraper_error.png")
            raise
        finally:
            browser.close()


if __name__ == "__main__":
    main()
