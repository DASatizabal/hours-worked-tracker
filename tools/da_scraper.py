"""
DA Payment Scraper & Auto-Importer
===================================
Logs into DataAnnotation Tech, expands all payment rows,
extracts the HTML, and imports it into the Hours Worked Tracker
for automatic reconciliation.

Setup:
    pip install playwright python-dotenv requests
    playwright install chromium

Usage:
    python da_scraper.py              # Full flow: scrape + import into tracker
    python da_scraper.py --html-only  # Just save HTML to file, skip tracker import
    python da_scraper.py --show-paid  # Also include already-paid entries
    python da_scraper.py --force      # Run regardless of payday setting
    python da_scraper.py --auto       # Unattended mode (headless, no prompts)

Credentials:
    Create a .env file in the tools/ directory:
        DA_EMAIL=your_email@example.com
        DA_PASSWORD=your_password
        APPS_SCRIPT_URL=https://script.google.com/macros/s/YOUR_ID/exec

Scheduling (Windows Task Scheduler):
    The script checks payday from Google Sheets and exits early if
    today isn't the configured payday. Schedule it to run daily:

    1. Open Task Scheduler > Create Basic Task
    2. Trigger: Daily, pick your morning time
    3. Action: Start a Program
       Program: python
       Arguments: "L:\\David's Folder\\Claude Projects\\hours-worked-tracker\\tools\\da_scraper.py" --auto
       Start in: "L:\\David's Folder\\Claude Projects\\hours-worked-tracker\\tools"
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
TRACKER_URL = "https://dasatizabal.github.io/hours-worked-tracker/"
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
        import requests
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


def import_into_tracker(context, html, auto_mode=False):
    """Open the Hours Worked Tracker, paste HTML, and auto-apply import."""
    log.info("[6/6] Importing into Hours Worked Tracker...")
    page = context.new_page()
    page.goto(TRACKER_URL, wait_until="networkidle", timeout=30000)
    page.wait_for_timeout(3000)

    # Click the DA Import button
    da_btn_selectors = [
        '#import-da-btn',
        'button:has-text("DA Import")',
        'button:has-text("Import DA")',
        '[onclick*="openDAImportModal"]',
    ]

    clicked = False
    for selector in da_btn_selectors:
        try:
            btn = page.locator(selector).first
            if btn.is_visible(timeout=2000):
                btn.click()
                page.wait_for_timeout(1000)
                clicked = True
                log.info("  -> DA Import modal opened.")
                break
        except Exception:
            continue

    if not clicked:
        if auto_mode:
            log.error("  -> Could not find DA Import button. Aborting auto-import.")
            return page
        else:
            log.warning("  -> Could not find DA Import button automatically.")
            input("     Open the modal manually, then press Enter...")

    # Paste HTML into the textarea
    page.evaluate("""(html) => {
        const textarea = document.getElementById('da-html-input');
        if (textarea) {
            textarea.value = html;
            textarea.dispatchEvent(new Event('input', { bubbles: true }));
            textarea.dispatchEvent(new Event('change', { bubbles: true }));
        }
    }""", html)
    log.info("  -> HTML pasted into import field.")

    # Click "Parse & Compare"
    try:
        parse_btn = page.locator('#da-parse-btn').first
        parse_btn.click()
        log.info("  -> Clicked 'Parse & Compare'.")
        # Wait for results to render
        page.wait_for_selector('#da-import-results:not(.hidden)', timeout=10000)
        page.wait_for_timeout(1000)
    except Exception as e:
        log.error(f"  -> Parse failed: {e}")
        if not auto_mode:
            input("     Press Enter to continue...")
        return page

    # Read summary counts from the results
    summary = page.evaluate("""() => {
        const corrections = document.getElementById('da-apply-corrections-btn');
        const addNew = document.getElementById('da-add-new-btn');
        return {
            correctionsVisible: corrections && !corrections.classList.contains('hidden'),
            correctionsText: corrections ? corrections.textContent.trim() : '',
            addNewVisible: addNew && !addNew.classList.contains('hidden'),
            addNewText: addNew ? addNew.textContent.trim() : ''
        };
    }""")
    log.info(f"  -> Results: corrections={summary['correctionsText']}, new={summary['addNewText']}")

    # Apply corrections if available
    if summary['correctionsVisible']:
        try:
            corrections_btn = page.locator('#da-apply-corrections-btn').first
            corrections_btn.click()
            log.info("  -> Applied corrections.")
            page.wait_for_timeout(2000)
        except Exception as e:
            log.error(f"  -> Failed to apply corrections: {e}")

    # Add new entries if available (checkboxes are pre-checked by default)
    if summary['addNewVisible']:
        try:
            add_btn = page.locator('#da-add-new-btn').first
            add_btn.click()
            log.info("  -> Added new entries.")
            page.wait_for_timeout(2000)
        except Exception as e:
            log.error(f"  -> Failed to add new entries: {e}")

    log.info("  -> Import complete!")

    if not auto_mode:
        input("\nPress Enter to close the browser...")

    return page


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
                # Step 6: Import into tracker
                import_into_tracker(context, combined_html, auto_mode=args.auto)

                log.info("")
                log.info("=" * 55)
                log.info(" DONE! Data reconciled in tracker.")
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
