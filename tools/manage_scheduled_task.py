"""
Manage Windows Task Scheduler task for DA automatic payout.

Reads auto-payout settings from Google Sheets and creates/updates/deletes
a weekly scheduled task accordingly.

Usage:
    python manage_scheduled_task.py                 # default profile
    python manage_scheduled_task.py --profile lisa   # lisa profile
"""

import argparse
import subprocess
import sys
import os
import logging
from pathlib import Path

import requests
from dotenv import load_dotenv

SCRIPT_DIR = Path(__file__).resolve().parent
REPO_DIR = SCRIPT_DIR.parent

# Day name mapping (matches JS: 0=Sunday, 1=Monday, ... 6=Saturday)
DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
# schtasks uses these abbreviated day names
SCHTASKS_DAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger(__name__)


def load_profile(profile):
    """Load .env file for the given profile and return APPS_SCRIPT_URL."""
    if profile == 'default':
        env_file = SCRIPT_DIR / '.env'
    else:
        env_file = SCRIPT_DIR / f'.env.{profile}'

    if not env_file.exists():
        log.error(f"Env file not found: {env_file}")
        sys.exit(1)

    load_dotenv(env_file, override=True)
    return os.getenv("APPS_SCRIPT_URL", "")


def get_settings_from_sheets(apps_script_url):
    """Fetch auto-payout settings from Google Sheets."""
    defaults = {
        'autoPayoutEnabled': False,
        'payoutWeekday': 2,
        'payoutHour': 12,
        'payoutAmPm': 'PM',
    }
    if not apps_script_url:
        log.warning("APPS_SCRIPT_URL not set, using defaults")
        return defaults

    try:
        url = apps_script_url + '?tab=Settings'
        response = requests.get(url, timeout=15, allow_redirects=True)
        data = response.json()
        records = data.get('records', [])
        settings = {}
        for r in records:
            settings[r.get('key')] = r.get('value')

        return {
            'autoPayoutEnabled': str(settings.get('autoPayoutEnabled', 'false')).lower() == 'true',
            'payoutWeekday': int(settings.get('payoutWeekday', 2)),
            'payoutHour': int(settings.get('payoutHour', 12)),
            'payoutAmPm': settings.get('payoutAmPm', 'PM'),
        }
    except Exception as e:
        log.warning(f"Could not read settings from Sheets: {e}")
        return defaults


def hour12_to_24(hour, ampm):
    """Convert 12-hour + AM/PM to 24-hour format."""
    if ampm == 'AM':
        return 0 if hour == 12 else hour
    return 12 if hour == 12 else hour + 12


def delete_task(task_name):
    """Delete a scheduled task if it exists."""
    # Check if task exists
    result = subprocess.run(
        ['schtasks', '/Query', '/TN', task_name],
        capture_output=True, text=True
    )
    if result.returncode != 0:
        log.info(f"Task '{task_name}' does not exist, nothing to delete")
        return

    result = subprocess.run(
        ['schtasks', '/Delete', '/TN', task_name, '/F'],
        capture_output=True, text=True
    )
    if result.returncode == 0:
        log.info(f"Deleted task '{task_name}'")
    else:
        log.error(f"Failed to delete task '{task_name}': {result.stderr}")


def create_task(task_name, profile, weekday, hour24):
    """Create or update a weekly scheduled task."""
    bat_file = SCRIPT_DIR / f'run_get_paid{"_" + profile if profile != "default" else ""}.bat'
    if not bat_file.exists():
        log.error(f"Batch file not found: {bat_file}")
        sys.exit(1)

    day_abbr = SCHTASKS_DAYS[weekday]
    time_str = f"{hour24:02d}:00"

    # Delete existing task first to update it
    delete_task(task_name)

    cmd = [
        'schtasks', '/Create',
        '/TN', task_name,
        '/TR', str(bat_file),
        '/SC', 'WEEKLY',
        '/D', day_abbr,
        '/ST', time_str,
        '/F'
    ]

    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode == 0:
        log.info(f"Created task '{task_name}': {DAY_NAMES[weekday]} at {time_str} -> {bat_file.name}")
    else:
        log.error(f"Failed to create task '{task_name}': {result.stderr}")
        sys.exit(1)


def main():
    parser = argparse.ArgumentParser(description="Manage DA Auto-Payout scheduled task")
    parser.add_argument("--profile", default="default",
                        help="Profile name: loads .env.<profile> (e.g., --profile lisa)")
    args = parser.parse_args()

    apps_script_url = load_profile(args.profile)
    settings = get_settings_from_sheets(apps_script_url)
    task_name = f"DA_AutoPayout_{args.profile}"

    log.info(f"Profile: {args.profile} | Auto-payout enabled: {settings['autoPayoutEnabled']} | "
             f"Day: {DAY_NAMES[settings['payoutWeekday']]} | "
             f"Time: {settings['payoutHour']} {settings['payoutAmPm']}")

    if not settings['autoPayoutEnabled']:
        log.info("Auto-payout is disabled — removing scheduled task if it exists")
        delete_task(task_name)
    else:
        hour24 = hour12_to_24(settings['payoutHour'], settings['payoutAmPm'])
        create_task(task_name, args.profile, settings['payoutWeekday'], hour24)


if __name__ == '__main__':
    main()
