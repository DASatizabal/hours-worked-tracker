"""
DA Scraper — Scrape-only (no payment claiming)
================================================
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
    python da_scraper.py --auto       # Unattended mode (headless, no prompts, daily scrape)
    python da_scraper.py --profile lisa  # Use Lisa's credentials

Credentials:
    Create a .env file in the tools/ directory:
        DA_EMAIL=your_email@example.com
        DA_PASSWORD=your_password
        APPS_SCRIPT_URL=https://script.google.com/macros/s/YOUR_ID/exec
"""

import os
import sys
import json
import re
import time
import argparse
import logging
from datetime import datetime, timezone
import requests
from bs4 import BeautifulSoup
from playwright.sync_api import sync_playwright, TimeoutError as PWTimeout

from da_common import (
    SCRIPT_DIR, HTML_OUTPUT_DIR, DA_PAYMENTS_URL,
    DA_EMAIL, DA_PASSWORD, APPS_SCRIPT_URL, DA_USER_EMAIL,
    reload_profile, login_to_da, create_browser_and_page, log,
)
import da_common

log = logging.getLogger("da_scraper")


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


def wait_for_payments_table(page, timeout_ms=15000):
    """Wait for the payments table to render with at least one row.

    Guards against a race where page.content() returns an empty body if React
    hasn't hydrated the table yet — seen as silent 28-byte HTML dumps with
    0 parsed entries. Raises if the table never shows up so the run fails
    loudly instead of importing nothing.
    """
    try:
        page.wait_for_function(
            """() => {
                const table = document.querySelector('table');
                if (!table) return false;
                return table.querySelectorAll('tr').length > 1;
            }""",
            timeout=timeout_ms,
        )
    except PWTimeout:
        raise RuntimeError(
            f"Payments table did not render within {timeout_ms}ms — "
            "page likely not fully hydrated. Aborting to avoid saving empty HTML."
        )


def toggle_show_paid(page, enable=False):
    """Toggle the 'Include paid' filter button (DA redesigned from checkbox to button)."""
    if not enable:
        return
    log.info("  -> Enabling 'Include paid' filter...")
    # Wait for React to hydrate the Funds History table
    page.wait_for_timeout(5000)
    # Use JS to find and click — Playwright selectors struggle with React-rendered buttons
    clicked = page.evaluate("""() => {
        const buttons = document.querySelectorAll('button');
        for (const btn of buttons) {
            if (btn.textContent.trim().toLowerCase() === 'include paid') {
                btn.click();
                return true;
            }
        }
        return false;
    }""")
    if clicked:
        page.wait_for_timeout(3000)
        log.info("  -> 'Include paid' toggled on.")
        return
    # Fallback: old checkbox UI
    try:
        checkbox = page.locator('input[type="checkbox"]').first
        if checkbox.is_visible(timeout=2000) and not checkbox.is_checked():
            checkbox.click()
            page.wait_for_timeout(2000)
            log.info("  -> 'Show paid' checkbox enabled (legacy UI).")
            return
    except Exception:
        pass
    log.info("  -> Could not toggle 'Include paid' — UI element not found.")


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
    wait_for_payments_table(page)
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

    Returns a list of dicts with: type, amount, duration, submittedAt, projectName
    """
    soup = BeautifulSoup(html, 'html.parser')
    rows = soup.select('tr[id^="row-"]')
    entries = []
    current_project = None
    is_bonus_project = False

    for row in rows:
        row_class = row.get('class', [])
        row_class_str = ' '.join(row_class) if isinstance(row_class, list) else str(row_class)
        is_date_row = 'tw-bg-[#E5D3EB]' in row_class_str or 'tw-border-primary-light-50' in row_class_str

        # Check indent level to distinguish headers vs sub-items
        title_td = row.select_one('[data-column-id="title"]')
        title_div = None
        title_div_class = ''
        if title_td:
            for d in title_td.select('div'):
                if any(c.startswith('tw-ml-') for c in d.get('class', [])):
                    title_div = d
                    title_div_class = ' '.join(d.get('class', []))
                    break
        is_sub_item = 'tw-ml-10' in title_div_class
        is_top_level = 'tw-ml-0' in title_div_class and not is_sub_item

        # Get title text
        title_span = row.select_one('[data-column-id="title"] span')
        title = title_span.get_text(strip=True) if title_span else ''

        # Get amount
        amount_td = row.select_one('[data-column-id="amount"]')
        amount = 0.0
        if amount_td:
            amount_el = (amount_td.select_one('.tw-font-semibold')
                         or amount_td.select_one('.tw-text-sm.tw-text-black-80'))
            if amount_el:
                amount_text = amount_el.get_text(strip=True)
            else:
                amount_cell = amount_td.select_one(':scope > div')
                amount_text = amount_cell.get_text(strip=True) if amount_cell else ''
            try:
                amount = float(re.sub(r'[$,]', '', amount_text))
            except (ValueError, TypeError):
                amount = 0.0

        # Get time/duration text
        time_cell = row.select_one('[data-column-id="time"] > div')
        if time_cell:
            time_text = time_cell.get_text(strip=True)
        else:
            duration_el = amount_td.select_one('.tw-text-sm.tw-text-black-60') if amount_td else None
            time_text = duration_el.get_text(strip=True) if duration_el else ''

        # Get submitted timestamp
        time_el = row.select_one('[data-column-id="timeAgo"] time[datetime]')
        if not time_el and amount_td:
            time_el = amount_td.select_one('time[datetime]')
        submitted_ms = None
        if time_el and time_el.get('datetime'):
            try:
                ts = int(time_el['datetime'])
                # DA reuses time[datetime] for two things:
                # - "Pending Approval · X ago" → past timestamp (submission date) ✓
                # - "Transferrable in X · Y ago" → future timestamp (payout window) ✗
                # Only use past timestamps as submittedAt
                if ts <= int(datetime.now(tz=timezone.utc).timestamp() * 1000):
                    submitted_ms = ts
            except (ValueError, TypeError):
                pass

        # Date rows are purple bg AND tw-ml-0 (top-level)
        if is_date_row and is_top_level:
            current_project = None
            is_bonus_project = False
            continue

        # Detect referral badge (blue badge with "referral" text)
        referral_badge = row.select_one('.tw-bg-blue-600')
        if referral_badge and referral_badge.get_text(strip=True).lower() == 'referral':
            if amount > 0:
                # Use DA's timestamp if it's in the past (actual submission date),
                # otherwise fall back to current time
                if submitted_ms:
                    ref_dt = datetime.fromtimestamp(submitted_ms / 1000, tz=timezone.utc)
                    ref_ms = submitted_ms
                else:
                    ref_dt = datetime.now(tz=timezone.utc)
                    ref_ms = int(ref_dt.timestamp() * 1000)
                entries.append({
                    'type': 'referral',
                    'amount': round(amount, 2),
                    'duration': 0,
                    'durationText': '',
                    'submittedAt': ref_dt.isoformat(),
                    'submittedAtMs': ref_ms,
                    'projectName': 'Referral Bonus'
                })
            continue

        # Project name headers
        is_project_header = (is_top_level or 'tw-ml-5' in title_div_class) and not is_sub_item
        if is_project_header and title not in ('Task Submission', 'Time Entry'):
            current_project = title
            is_bonus_project = bool(re.search(r'(?i)submission\s+bonus|bonus\s+survey', title))
            continue

        if not is_sub_item:
            continue

        # Parse sub-items
        if title == 'Time Entry' and amount > 0 and submitted_ms:
            duration = 0.0
            h_match = re.search(r'(\d+)\s*h', time_text)
            m_match = re.search(r'(\d+)\s*min', time_text)
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
            submitted_dt = datetime.fromtimestamp(submitted_ms / 1000, tz=timezone.utc)
            entry_type = 'bonus' if is_bonus_project else 'task'
            entries.append({
                'type': entry_type,
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
    if not da_common.APPS_SCRIPT_URL:
        log.error("APPS_SCRIPT_URL not set in .env — cannot fetch sessions.")
        return None

    try:
        url = da_common.APPS_SCRIPT_URL + '?tab=WorkSessions'
        response = requests.get(url, timeout=30, allow_redirects=True)
        data = response.json()
        records = data.get('records', [])
        log.info(f"  -> Fetched {len(records)} existing work sessions from Sheets")
        return records
    except Exception as e:
        log.error(f"  -> Failed to fetch sessions: {e}")
        return None


def reconcile_da_entries(da_entries, sessions):
    """Match DA entries against existing sessions."""
    matched = []
    corrections = []
    unmatched = []
    used_session_ids = set()

    for da in da_entries:
        if not da['submittedAt']:
            unmatched.append({'da': da})
            continue

        da_date = datetime.fromisoformat(da['submittedAt'])

        best_match = None
        best_time_diff = float('inf')

        for session in sessions:
            sid = session.get('id', '')
            if sid in used_session_ids:
                continue

            try:
                s_earnings = round(float(session.get('earnings', 0)), 2)
            except (ValueError, TypeError):
                continue
            if s_earnings != da['amount']:
                continue

            if session.get('type') != da['type']:
                continue

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
    """Push corrections and new entries to Google Sheets via Apps Script."""
    if not da_common.APPS_SCRIPT_URL:
        log.error("APPS_SCRIPT_URL not set — cannot import to Sheets.")
        return

    if not corrections and not unmatched:
        log.info("[6/6] Nothing to import — all entries already matched.")
        return

    log.info(f"[6/6] Importing to Sheets: {len(corrections)} corrections, {len(unmatched)} new entries...")

    for c in corrections:
        session = c['session']
        da = c['da']
        updates = {'submittedAt': c['newSubmittedAt']}

        s_duration = float(session.get('duration', 0) or 0)
        if da['duration'] > 0 and s_duration == 0:
            updates['duration'] = da['duration']
            updates['hourlyRate'] = round(da['amount'] / da['duration'])

        if da['projectName'] and not session.get('projectId'):
            updates['projectId'] = da['projectName']

        try:
            payload = json.dumps({
                'action': 'update',
                'tab': 'WorkSessions',
                'id': session['id'],
                'updates': updates
            })
            resp = requests.post(
                da_common.APPS_SCRIPT_URL,
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

    for u in unmatched:
        da = u['da']
        record_id = f"ws_{int(time.time() * 1000)}_{os.urandom(4).hex()}"
        user_email = da_common.DA_USER_EMAIL or da_common.DA_EMAIL
        record_date = da['submittedAt'][:10] if da['submittedAt'] else datetime.now().strftime('%Y-%m-%d')
        record = {
            'id': record_id,
            'userEmail': user_email,
            'date': record_date,
            'duration': da['duration'],
            'type': da['type'],
            'projectId': da['projectName'],
            'notes': 'Referral Bonus' if da['type'] == 'referral' else 'Submission Bonus' if da['type'] == 'bonus' else '',
            'hourlyRate': round(da['amount'] / da['duration']) if da['duration'] > 0 else 0,
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
                da_common.APPS_SCRIPT_URL,
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

        time.sleep(0.05)


def main():
    parser = argparse.ArgumentParser(description="DA Payment Scraper (scrape only, no payment claiming)")
    parser.add_argument("--html-only", action="store_true",
                        help="Only extract and save HTML, don't import into tracker")
    parser.add_argument("--headless", action="store_true",
                        help="Run without visible browser")
    parser.add_argument("--show-paid", action="store_true",
                        help="Include already-paid entries (check 'Show paid')")
    parser.add_argument("--auto", action="store_true",
                        help="Unattended mode: headless, no prompts")
    parser.add_argument("--profile", default="default",
                        help="Profile name: loads .env.<profile> (e.g., --profile lisa)")
    args = parser.parse_args()

    if args.profile != 'default':
        reload_profile(args.profile)

    if args.auto:
        args.headless = True

    log.info("Starting daily scrape...")

    if not da_common.DA_EMAIL or not da_common.DA_PASSWORD:
        log.error("Missing credentials! Create a .env file with DA_EMAIL and DA_PASSWORD.")
        sys.exit(1)

    with sync_playwright() as p:
        browser, page = create_browser_and_page(p, headless=args.headless, block_payouts=True)

        try:
            login_to_da(page)

            html_parts = scrape_all_pages(page, show_paid=args.show_paid)
            combined_html = combine_html_pages(html_parts)

            saved_path = save_html_to_file(combined_html)

            if args.html_only:
                log.info(f"\nDone! HTML saved to: {saved_path}")
            else:
                da_entries = parse_da_html(combined_html)

                # No parser-level dedup — the reconciler handles dedup against
                # existing sessions. Parser dedup was too aggressive: $10 task
                # submissions from different reviews can share (timestamp, amount,
                # type) keys and were being falsely removed.

                sessions = fetch_existing_sessions()
                if sessions is None:
                    log.error("Cannot reconcile without existing sessions. "
                              "Aborting import to prevent duplicates. HTML backup saved.")
                else:
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
