"""
DA Common — Shared infrastructure for DA scraper and payer.
============================================================
Login, browser setup, email verification, config loading, and payday utilities.
"""

import os
import sys
import re
import imaplib
import email as email_lib
import logging
import time
from pathlib import Path
from datetime import datetime, timezone, timedelta
import requests
from dotenv import load_dotenv
from playwright.sync_api import TimeoutError as PWTimeout

# Paths
SCRIPT_DIR = Path(__file__).parent
HTML_OUTPUT_DIR = SCRIPT_DIR / "da_html_exports"
DA_PAYMENTS_URL = "https://app.dataannotation.tech/workers/payments"

# Day name mapping (matches JS: 0=Sunday, 1=Monday, ... 6=Saturday)
DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
DEFAULT_PAYOUT_WEEKDAY = 2  # Tuesday

# Logging — both scraper and payer write to the same daily log file
LOG_DIR = SCRIPT_DIR / "logs"
LOG_DIR.mkdir(exist_ok=True)
log_file = LOG_DIR / f"scraper_{datetime.now().strftime('%Y-%m-%d')}.log"
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
    handlers=[logging.StreamHandler(), logging.FileHandler(log_file)]
)
log = logging.getLogger("da_common")

# Load default .env
load_dotenv(SCRIPT_DIR / '.env')

DA_EMAIL = os.getenv("DA_EMAIL")
DA_PASSWORD = os.getenv("DA_PASSWORD")
GMAIL_APP_PASSWORD = os.getenv("GMAIL_APP_PASSWORD", "")
YAHOO_APP_PASSWORD = os.getenv("YAHOO_APP_PASSWORD", "")
APPS_SCRIPT_URL = os.getenv("APPS_SCRIPT_URL", "")
DA_USER_EMAIL = os.getenv("DA_USER_EMAIL", "")
EMAIL_PROVIDER = os.getenv("EMAIL_PROVIDER", "gmail")
IMAP_EMAIL = os.getenv("IMAP_EMAIL", "")


def reload_profile(profile):
    """Load a profile-specific .env file, overriding all config globals."""
    global DA_EMAIL, DA_PASSWORD, GMAIL_APP_PASSWORD, YAHOO_APP_PASSWORD
    global APPS_SCRIPT_URL, DA_USER_EMAIL, EMAIL_PROVIDER, IMAP_EMAIL

    profile_env = SCRIPT_DIR / f'.env.{profile}'
    if not profile_env.exists():
        log.error(f"Profile .env file not found: {profile_env}")
        sys.exit(1)
    load_dotenv(profile_env, override=True)
    DA_EMAIL = os.getenv("DA_EMAIL")
    DA_PASSWORD = os.getenv("DA_PASSWORD")
    GMAIL_APP_PASSWORD = os.getenv("GMAIL_APP_PASSWORD", "")
    YAHOO_APP_PASSWORD = os.getenv("YAHOO_APP_PASSWORD", "")
    APPS_SCRIPT_URL = os.getenv("APPS_SCRIPT_URL", "")
    DA_USER_EMAIL = os.getenv("DA_USER_EMAIL", "")
    EMAIL_PROVIDER = os.getenv("EMAIL_PROVIDER", "gmail")
    IMAP_EMAIL = os.getenv("IMAP_EMAIL", "")
    log.info(f"Loaded profile: {profile} ({DA_EMAIL})")


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


def get_auto_payout_settings():
    """Read auto-payout settings from Google Sheets via Apps Script."""
    defaults = {
        'autoPayoutEnabled': False,
        'payoutHour': 12,
        'payoutAmPm': 'PM',
    }
    if not APPS_SCRIPT_URL:
        log.warning("APPS_SCRIPT_URL not set, using default auto-payout settings")
        return defaults

    try:
        url = APPS_SCRIPT_URL + '?tab=Settings'
        response = requests.get(url, timeout=15, allow_redirects=True)
        data = response.json()
        records = data.get('records', [])
        settings = {}
        for r in records:
            settings[r.get('key')] = r.get('value')

        return {
            'autoPayoutEnabled': str(settings.get('autoPayoutEnabled', 'false')).lower() == 'true',
            'payoutHour': int(settings.get('payoutHour', 12)),
            'payoutAmPm': settings.get('payoutAmPm', 'PM'),
        }
    except Exception as e:
        log.warning(f"Could not read auto-payout settings from Sheets: {e}")
        return defaults


def is_today_payday(payday_weekday):
    """Check if today matches the configured payday.
    Python weekday: Monday=0 ... Sunday=6
    JS weekday: Sunday=0 ... Saturday=6
    """
    today_py = datetime.now().weekday()  # Monday=0
    today_js = (today_py + 1) % 7  # Sunday=0
    return today_js == payday_weekday


def fetch_verification_code_from_email(max_retries=5, retry_delay=5):
    """Fetch a verification code from email via IMAP (Gmail or Yahoo)."""
    if EMAIL_PROVIDER.lower() == 'yahoo':
        app_password = YAHOO_APP_PASSWORD
        imap_host = "imap.mail.yahoo.com"
    else:
        app_password = GMAIL_APP_PASSWORD
        imap_host = "imap.gmail.com"

    if not app_password:
        log.error(f"{'YAHOO' if EMAIL_PROVIDER.lower() == 'yahoo' else 'GMAIL'}_APP_PASSWORD not set in .env — cannot fetch verification code.")
        return None

    imap_login = IMAP_EMAIL or DA_EMAIL
    sender_patterns = ["dataannotation", "noreply@"]
    code_pattern = re.compile(r'\b(\d{6})\b')

    for attempt in range(1, max_retries + 1):
        log.info(f"  -> Checking {EMAIL_PROVIDER} ({imap_login}) for verification code (attempt {attempt}/{max_retries})...")
        try:
            mail = imaplib.IMAP4_SSL(imap_host, 993)
            mail.login(imap_login, app_password)
            mail.select("INBOX")

            since_date = (datetime.now() - timedelta(minutes=5)).strftime("%d-%b-%Y")
            _, msg_ids = mail.search(None, f'(SINCE "{since_date}")')

            if not msg_ids[0]:
                log.info(f"     No recent emails found.")
                mail.logout()
                if attempt < max_retries:
                    time.sleep(retry_delay)
                continue

            id_list = msg_ids[0].split()
            for msg_id in reversed(id_list):
                _, msg_data = mail.fetch(msg_id, "(RFC822)")
                raw_email = msg_data[0][1]
                msg = email_lib.message_from_bytes(raw_email)

                sender = (msg.get("From", "") or "").lower()
                subject = (msg.get("Subject", "") or "").lower()
                if not any(p in sender for p in sender_patterns) and "verification" not in subject and "code" not in subject:
                    continue

                date_str = msg.get("Date", "")
                try:
                    msg_date = email_lib.utils.parsedate_to_datetime(date_str)
                    if msg_date.tzinfo is None:
                        msg_date = msg_date.replace(tzinfo=timezone.utc)
                    age = datetime.now(timezone.utc) - msg_date
                    if age > timedelta(minutes=5):
                        continue
                except Exception:
                    pass

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
            log.warning(f"  -> Email fetch error: {e}")

        if attempt < max_retries:
            log.info(f"     Code not found yet, retrying in {retry_delay}s...")
            time.sleep(retry_delay)

    log.error(f"  -> Could not find verification code in {EMAIL_PROVIDER} after all retries.")
    return None


def login_to_da(page):
    """Navigate to DA and log in with email/password."""
    log.info("[1/6] Navigating to DA payments page...")
    page.goto(DA_PAYMENTS_URL, wait_until="domcontentloaded", timeout=30000)

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

        page.wait_for_timeout(3000)

        if "/workers/" in page.url:
            log.info("  -> Login successful (no verification needed)!")
        else:
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

                code = fetch_verification_code_from_email()
                if not code:
                    log.error("  -> Failed to get verification code. Cannot proceed.")
                    raise Exception("Verification code required but could not be fetched from Gmail.")

                code_input.fill(code)
                log.info(f"  -> Entered verification code.")

                verify_btn = page.locator('button[type="submit"], input[type="submit"]').first
                verify_btn.click()

                page.wait_for_url("**/workers/**", timeout=60000)
                log.info("  -> Login successful (with verification code)!")

            except PWTimeout:
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

    if "/workers/payments" not in page.url:
        page.goto(DA_PAYMENTS_URL, wait_until="domcontentloaded", timeout=30000)

    page.wait_for_timeout(2000)


def create_browser_and_page(playwright, headless=False, block_payouts=False):
    """Launch Chromium and create a page with standard settings and debug listeners.

    Args:
        block_payouts: If True, intercept and abort any POST to /get_paid.
            Used by the scraper to prevent DA's frontend JS from auto-triggering payouts.
    """
    browser = playwright.chromium.launch(headless=headless)
    context = browser.new_context(
        viewport={"width": 1400, "height": 900},
        user_agent=(
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/120.0.0.0 Safari/537.36"
        )
    )
    page = context.new_page()

    # Block DA's auto-payout: their frontend JS fires POST /get_paid on page load
    # when the 72h cooldown has expired. Only the payer script should allow this.
    if block_payouts:
        def handle_route(route):
            log.info(f"  [BLOCKED] {route.request.method} {route.request.url} — auto-payout intercepted")
            route.abort()
        page.route("**/workers/payments/get_paid", handle_route)

    # Capture browser console messages and network requests for debugging
    def on_console(msg):
        text = msg.text.lower()
        if any(kw in text for kw in ['payout', 'pay', 'transfer', 'withdraw', 'claim', 'balance']):
            log.info(f"  [CONSOLE] {msg.type}: {msg.text[:300]}")
    page.on("console", on_console)

    def on_response(response):
        url = response.url.lower()
        if any(kw in url for kw in ['payout', 'pay', 'transfer', 'withdraw', 'claim', 'stripe']):
            log.info(f"  [NETWORK] {response.status} {response.request.method} {response.url[:200]}")
    page.on("response", on_response)

    return browser, page
