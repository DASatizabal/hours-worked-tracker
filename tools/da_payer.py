"""
DA Payer — Pay-only (no scraping)
==================================
Logs into DataAnnotation Tech and clicks the 'Get paid' button
to request a payout. No scraping, no HTML parsing, no data import.

Usage:
    python da_payer.py                # Request payout (payday check applies)
    python da_payer.py --force        # Request payout regardless of day
    python da_payer.py --auto         # Headless payout for Task Scheduler
    python da_payer.py --profile lisa # Use Lisa's credentials

Credentials:
    Create a .env file in the tools/ directory:
        DA_EMAIL=your_email@example.com
        DA_PASSWORD=your_password
        APPS_SCRIPT_URL=https://script.google.com/macros/s/YOUR_ID/exec
"""

import sys
import argparse
import logging
from datetime import datetime
from playwright.sync_api import sync_playwright, TimeoutError as PWTimeout

from da_common import (
    SCRIPT_DIR, DAY_NAMES,
    reload_profile, login_to_da, create_browser_and_page,
    get_payday_from_sheets, get_auto_payout_settings, is_today_payday,
)
import da_common

log = logging.getLogger("da_payer")


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


def main():
    parser = argparse.ArgumentParser(description="DA Payer — request payout from DataAnnotation")
    parser.add_argument("--headless", action="store_true",
                        help="Run without visible browser")
    parser.add_argument("--force", action="store_true",
                        help="Skip payday check")
    parser.add_argument("--auto", action="store_true",
                        help="Unattended mode: headless, check auto-payout setting")
    parser.add_argument("--profile", default="default",
                        help="Profile name: loads .env.<profile> (e.g., --profile lisa)")
    args = parser.parse_args()

    if args.profile != 'default':
        reload_profile(args.profile)

    if args.auto:
        args.headless = True

    # Payday and auto-payout checks
    if not args.force:
        if args.auto:
            auto_settings = get_auto_payout_settings()
            if not auto_settings['autoPayoutEnabled']:
                log.info("Auto-payout is disabled in settings. Exiting. "
                         "(Enable in app Settings or use --force to override)")
                sys.exit(0)

        payday = get_payday_from_sheets()
        if not is_today_payday(payday):
            log.info(f"Today is {DAY_NAMES[(datetime.now().weekday() + 1) % 7]}, "
                     f"payday is {DAY_NAMES[payday]}. Skipping payout. (Use --force to override)")
            sys.exit(0)
        log.info(f"Today is payday ({DAY_NAMES[payday]})! Starting payment claim...")
    else:
        log.info("Starting payment claim (--force, skipping payday check)...")

    if not da_common.DA_EMAIL or not da_common.DA_PASSWORD:
        log.error("Missing credentials! Create a .env file with DA_EMAIL and DA_PASSWORD.")
        sys.exit(1)

    with sync_playwright() as p:
        browser, page = create_browser_and_page(p, headless=args.headless)

        try:
            login_to_da(page)
            claim_payment(page)
        except Exception as e:
            log.error(f"ERROR: {e}")
            page.screenshot(path=str(SCRIPT_DIR / "da_payer_error.png"))
            log.error("Screenshot saved to da_payer_error.png")
            raise
        finally:
            browser.close()


if __name__ == "__main__":
    main()
