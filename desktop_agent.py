#!/usr/bin/env python3
"""
FocusGuard AI — Cross-platform Desktop System Monitor Agent
=====================================================
Tracks which apps are open and active on Windows and macOS.
Runs in the background, posts real-time data to the Django backend.

Usage:
    python desktop_agent.py

Requirements:
    pip install psutil requests python-decouple
    # Windows only (optional, for Focus Shield minimize):
    pip install pywin32
"""

import sys
import os
import time
import logging
import requests
import psutil
import subprocess
import re
import ctypes
from datetime import datetime, timezone
from pathlib import Path

# Safe Win32 imports for Windows
if sys.platform == 'win32':
    try:
        import win32gui
        import win32process
        import win32con
        import win32api
        from ctypes import wintypes
    except ImportError:
        wintypes = None
else:
    wintypes = None

# ─── Load .env from parent directory ───────────────────────────────────────
ENV_PATH = Path(__file__).parent / '.env'
if ENV_PATH.exists():
    from decouple import Config, RepositoryEnv
    _config = Config(RepositoryEnv(str(ENV_PATH)))
else:
    from decouple import config as _config  # fallback

# ─── Cross-Platform Idle Detection (Max 10 Minutes Limit) ───────────────────
def get_idle_duration_secs() -> float:
    """Returns seconds since last user keyboard or mouse input."""
    if sys.platform == 'win32' and wintypes is not None:
        try:
            class LASTINPUTINFO(ctypes.Structure):
                _fields_ = [
                    ('cbSize', wintypes.UINT),
                    ('dwTime', wintypes.DWORD),
                ]
            lii = LASTINPUTINFO()
            lii.cbSize = ctypes.sizeof(LASTINPUTINFO)
            if ctypes.windll.user32.GetLastInputInfo(ctypes.byref(lii)):
                millis = ctypes.windll.kernel32.GetTickCount() - lii.dwTime
                return max(0.0, millis / 1000.0)
        except Exception:
            pass
        return 0.0
    elif sys.platform == 'darwin':
        try:
            cmd = ['ioreg', '-c', 'IOHIDSystem']
            res = subprocess.run(cmd, capture_output=True, text=True, timeout=2)
            match = re.search(r'"HIDIdleTime"\s*=\s*(\d+)', res.stdout)
            if match:
                return max(0.0, float(match.group(1)) / 1e9)
        except Exception:
            pass
        return 0.0
    return 0.0

MAX_IDLE_SECS = float(_config('AGENT_MAX_IDLE_SECS', default='600'))  # 10 minutes max idle

# ─── Config ─────────────────────────────────────────────────────────────────
API_BASE    = _config('AGENT_API_BASE', default='http://127.0.0.1:8000/api')
USERNAME    = _config('AGENT_USERNAME',  default='admin')
PASSWORD    = _config('AGENT_PASSWORD',  default='admin123')
POLL_SECS   = float(_config('AGENT_POLL_SECS', default='3'))   # check active window every N seconds
LOG_LEVEL   = _config('AGENT_LOG_LEVEL', default='INFO')
APP_BLOCKER_ENABLED = _config('AGENT_APP_BLOCKER', default=True, cast=bool)

# ─── Logging ────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=getattr(logging, LOG_LEVEL.upper(), logging.INFO),
    format='%(asctime)s [%(levelname)s] %(message)s',
    datefmt='%H:%M:%S'
)
log = logging.getLogger('focusguard-agent')

# ─── App Classification Map ─────────────────────────────────────────────────
# Maps process_name.lower() → (app_display_name, category, productivity_tier)
APP_MAP = {
    # ── Development (Windows & macOS) ──
    'antigravity ide.exe':   ('Antigravity IDE',        'DEVELOPMENT',   'PRODUCTIVE'),
    'antigravity':           ('Antigravity IDE',        'DEVELOPMENT',   'PRODUCTIVE'),
    'code.exe':              ('Visual Studio Code',     'DEVELOPMENT',   'PRODUCTIVE'),
    'code':                  ('Visual Studio Code',     'DEVELOPMENT',   'PRODUCTIVE'),
    'visual studio code':    ('Visual Studio Code',     'DEVELOPMENT',   'PRODUCTIVE'),
    'code - insiders.exe':   ('VS Code Insiders',       'DEVELOPMENT',   'PRODUCTIVE'),
    'xcode':                 ('Xcode',                  'DEVELOPMENT',   'PRODUCTIVE'),
    'pycharm64.exe':         ('PyCharm',                'DEVELOPMENT',   'PRODUCTIVE'),
    'pycharm.exe':           ('PyCharm',                'DEVELOPMENT',   'PRODUCTIVE'),
    'pycharm':               ('PyCharm',                'DEVELOPMENT',   'PRODUCTIVE'),
    'idea64.exe':            ('IntelliJ IDEA',          'DEVELOPMENT',   'PRODUCTIVE'),
    'webstorm64.exe':        ('WebStorm',               'DEVELOPMENT',   'PRODUCTIVE'),
    'devenv.exe':            ('Visual Studio',          'DEVELOPMENT',   'PRODUCTIVE'),
    'cursor.exe':            ('Cursor',                 'DEVELOPMENT',   'PRODUCTIVE'),
    'cursor':                ('Cursor',                 'DEVELOPMENT',   'PRODUCTIVE'),
    'windsurf.exe':          ('Windsurf',               'DEVELOPMENT',   'PRODUCTIVE'),
    'windsurf':              ('Windsurf',               'DEVELOPMENT',   'PRODUCTIVE'),
    'android studio.exe':    ('Android Studio',         'DEVELOPMENT',   'PRODUCTIVE'),
    'androidstudio.exe':     ('Android Studio',         'DEVELOPMENT',   'PRODUCTIVE'),
    'android studio':        ('Android Studio',         'DEVELOPMENT',   'PRODUCTIVE'),
    'postman.exe':           ('Postman',                'DEVELOPMENT',   'PRODUCTIVE'),
    'postman':               ('Postman',                'DEVELOPMENT',   'PRODUCTIVE'),
    'insomnia.exe':          ('Insomnia',               'DEVELOPMENT',   'PRODUCTIVE'),
    'dbeaver.exe':           ('DBeaver',                'DEVELOPMENT',   'PRODUCTIVE'),
    'datagrip64.exe':        ('DataGrip',               'DEVELOPMENT',   'PRODUCTIVE'),
    'sublime_text.exe':      ('Sublime Text',           'DEVELOPMENT',   'PRODUCTIVE'),
    'sublime text':          ('Sublime Text',           'DEVELOPMENT',   'PRODUCTIVE'),
    'notepad++.exe':         ('Notepad++',              'DEVELOPMENT',   'PRODUCTIVE'),
    'atom.exe':              ('Atom',                   'DEVELOPMENT',   'PRODUCTIVE'),
    'figma.exe':             ('Figma',                  'CREATIVE',      'PRODUCTIVE'),
    'figma':                 ('Figma',                  'CREATIVE',      'PRODUCTIVE'),
    'git-bash.exe':          ('Git Bash',               'DEVELOPMENT',   'PRODUCTIVE'),
    'github desktop.exe':    ('GitHub Desktop',         'DEVELOPMENT',   'PRODUCTIVE'),
    'github desktop':        ('GitHub Desktop',         'DEVELOPMENT',   'PRODUCTIVE'),
    'wt.exe':                ('Windows Terminal',       'DEVELOPMENT',   'PRODUCTIVE'),
    'windowsterminal.exe':   ('Windows Terminal',       'DEVELOPMENT',   'PRODUCTIVE'),
    'terminal':              ('Terminal',               'DEVELOPMENT',   'PRODUCTIVE'),
    'iterm':                 ('iTerm2',                 'DEVELOPMENT',   'PRODUCTIVE'),
    'iterm2':                ('iTerm2',                 'DEVELOPMENT',   'PRODUCTIVE'),
    'powershell.exe':        ('PowerShell',             'DEVELOPMENT',   'PRODUCTIVE'),
    'powershell_ise.exe':    ('PowerShell ISE',         'DEVELOPMENT',   'PRODUCTIVE'),
    'cmd.exe':               ('Command Prompt',         'DEVELOPMENT',   'PRODUCTIVE'),
    'python.exe':            ('Python',                 'DEVELOPMENT',   'PRODUCTIVE'),
    'python':                ('Python',                 'DEVELOPMENT',   'PRODUCTIVE'),
    'node.exe':              ('Node.js',                'DEVELOPMENT',   'PRODUCTIVE'),
    'docker desktop.exe':    ('Docker Desktop',         'DEVELOPMENT',   'PRODUCTIVE'),
    'docker':                ('Docker Desktop',         'DEVELOPMENT',   'PRODUCTIVE'),

    # ── Web Browsers (Windows & macOS) ──
    'chrome.exe':            ('Google Chrome',          'BROWSER',       'NEUTRAL'),
    'google chrome':         ('Google Chrome',          'BROWSER',       'NEUTRAL'),
    'chrome':                ('Google Chrome',          'BROWSER',       'NEUTRAL'),
    'safari':                ('Safari',                 'BROWSER',       'NEUTRAL'),
    'firefox.exe':           ('Firefox',                'BROWSER',       'NEUTRAL'),
    'firefox':               ('Firefox',                'BROWSER',       'NEUTRAL'),
    'msedge.exe':            ('Microsoft Edge',         'BROWSER',       'NEUTRAL'),
    'microsoft edge':        ('Microsoft Edge',         'BROWSER',       'NEUTRAL'),
    'opera.exe':             ('Opera',                  'BROWSER',       'NEUTRAL'),
    'opera':                 ('Opera',                  'BROWSER',       'NEUTRAL'),
    'brave.exe':             ('Brave Browser',          'BROWSER',       'NEUTRAL'),
    'brave browser':         ('Brave Browser',          'BROWSER',       'NEUTRAL'),
    'brave':                 ('Brave Browser',          'BROWSER',       'NEUTRAL'),
    'vivaldi.exe':           ('Vivaldi',                'BROWSER',       'NEUTRAL'),
    'vivaldi':               ('Vivaldi',                'BROWSER',       'NEUTRAL'),
    'arc.exe':               ('Arc Browser',            'BROWSER',       'NEUTRAL'),
    'arc':                   ('Arc Browser',            'BROWSER',       'NEUTRAL'),

    # ── Productive / Work ──
    'winword.exe':           ('Microsoft Word',         'PRODUCTIVE',    'PRODUCTIVE'),
    'excel.exe':             ('Microsoft Excel',        'PRODUCTIVE',    'PRODUCTIVE'),
    'powerpnt.exe':          ('PowerPoint',             'PRODUCTIVE',    'PRODUCTIVE'),
    'onenote.exe':           ('OneNote',                'PRODUCTIVE',    'PRODUCTIVE'),
    'pages':                 ('Pages',                  'PRODUCTIVE',    'PRODUCTIVE'),
    'keynote':               ('Keynote',                'PRODUCTIVE',    'PRODUCTIVE'),
    'numbers':               ('Numbers',                'PRODUCTIVE',    'PRODUCTIVE'),
    'notes':                 ('Apple Notes',            'PRODUCTIVE',    'PRODUCTIVE'),
    'preview':               ('Preview',                'PRODUCTIVE',    'PRODUCTIVE'),
    'outlook.exe':           ('Outlook',                'COMMUNICATION', 'NEUTRAL'),
    'teams.exe':             ('Microsoft Teams',        'COMMUNICATION', 'NEUTRAL'),
    'microsoft teams':       ('Microsoft Teams',        'COMMUNICATION', 'NEUTRAL'),
    'slack.exe':             ('Slack',                  'COMMUNICATION', 'NEUTRAL'),
    'slack':                 ('Slack',                  'COMMUNICATION', 'NEUTRAL'),
    'zoom.exe':              ('Zoom',                   'COMMUNICATION', 'NEUTRAL'),
    'zoom.us':               ('Zoom',                   'COMMUNICATION', 'NEUTRAL'),
    'zoom':                  ('Zoom',                   'COMMUNICATION', 'NEUTRAL'),
    'whatsapp.root.exe':     ('WhatsApp',               'COMMUNICATION', 'NEUTRAL'),
    'whatsapp.exe':          ('WhatsApp',               'COMMUNICATION', 'NEUTRAL'),
    'whatsapp':              ('WhatsApp',               'COMMUNICATION', 'NEUTRAL'),
    'notion.exe':            ('Notion',                 'PRODUCTIVE',    'PRODUCTIVE'),
    'notion':                ('Notion',                 'PRODUCTIVE',    'PRODUCTIVE'),
    'obsidian.exe':          ('Obsidian',               'EDUCATION',     'PRODUCTIVE'),
    'obsidian':              ('Obsidian',               'EDUCATION',     'PRODUCTIVE'),
    'acrobat.exe':           ('Adobe Acrobat',          'PRODUCTIVE',    'PRODUCTIVE'),
    'acrord32.exe':          ('Adobe Acrobat Reader',   'PRODUCTIVE',    'PRODUCTIVE'),
    'foxit reader.exe':      ('Foxit Reader',           'PRODUCTIVE',    'PRODUCTIVE'),

    # ── Creative ──
    'photoshop.exe':         ('Adobe Photoshop',        'CREATIVE',      'PRODUCTIVE'),
    'illustrator.exe':       ('Adobe Illustrator',      'CREATIVE',      'PRODUCTIVE'),
    'premiere pro.exe':      ('Adobe Premiere',         'CREATIVE',      'PRODUCTIVE'),
    'afterfx.exe':           ('Adobe After Effects',    'CREATIVE',      'PRODUCTIVE'),
    'blender.exe':           ('Blender',                'CREATIVE',      'PRODUCTIVE'),
    'blender':               ('Blender',                'CREATIVE',      'PRODUCTIVE'),
    'canva.exe':             ('Canva',                  'CREATIVE',      'PRODUCTIVE'),
    'canva':                 ('Canva',                  'CREATIVE',      'PRODUCTIVE'),
    'paint.net.exe':         ('Paint.NET',              'CREATIVE',      'PRODUCTIVE'),
    'mspaint.exe':           ('MS Paint',               'CREATIVE',      'NEUTRAL'),
    'davinci resolve.exe':   ('DaVinci Resolve',        'CREATIVE',      'PRODUCTIVE'),

    # ── Entertainment / Media ──
    'vlc.exe':               ('VLC Media Player',       'ENTERTAINMENT', 'DISTRACTING'),
    'vlc':                   ('VLC Media Player',       'ENTERTAINMENT', 'DISTRACTING'),
    'wmplayer.exe':          ('Windows Media Player',   'ENTERTAINMENT', 'DISTRACTING'),
    'netflix.exe':           ('Netflix',                'ENTERTAINMENT', 'DISTRACTING'),
    'spotify.exe':           ('Spotify',                'ENTERTAINMENT', 'NEUTRAL'),
    'spotify':               ('Spotify',                'ENTERTAINMENT', 'NEUTRAL'),
    'music':                 ('Apple Music',            'ENTERTAINMENT', 'NEUTRAL'),
    'itunes.exe':            ('iTunes',                 'ENTERTAINMENT', 'NEUTRAL'),
    'musicbee.exe':          ('MusicBee',               'ENTERTAINMENT', 'NEUTRAL'),
    'foobar2000.exe':        ('foobar2000',             'ENTERTAINMENT', 'NEUTRAL'),
    'mpc-hc64.exe':          ('Media Player Classic',   'ENTERTAINMENT', 'DISTRACTING'),
    'mpc-hc.exe':            ('Media Player Classic',   'ENTERTAINMENT', 'DISTRACTING'),
    'kodi.exe':              ('Kodi',                   'ENTERTAINMENT', 'DISTRACTING'),
    'potplayer64.exe':       ('PotPlayer',              'ENTERTAINMENT', 'DISTRACTING'),

    # ── Gaming ──
    'steam.exe':             ('Steam',                  'GAMING',        'DISTRACTING'),
    'steam':                 ('Steam',                  'GAMING',        'DISTRACTING'),
    'epicgameslauncher.exe': ('Epic Games Launcher',    'GAMING',        'DISTRACTING'),
    'battle.net.exe':        ('Battle.net',             'GAMING',        'DISTRACTING'),
    'leagueclient.exe':      ('League of Legends',      'GAMING',        'DISTRACTING'),
    'valorant.exe':          ('Valorant',               'GAMING',        'DISTRACTING'),
    'minecraft.exe':         ('Minecraft',              'GAMING',        'DISTRACTING'),
    'roblox.exe':            ('Roblox',                 'GAMING',        'DISTRACTING'),

    # ── System / Utility ──
    'explorer.exe':          ('File Explorer',          'SYSTEM',        'NEUTRAL'),
    'finder':                ('Finder',                 'SYSTEM',        'NEUTRAL'),
    'system settings':       ('System Settings',        'SYSTEM',        'NEUTRAL'),
    'system preferences':    ('System Preferences',     'SYSTEM',        'NEUTRAL'),
    'activity monitor':      ('Activity Monitor',       'SYSTEM',        'NEUTRAL'),
    'taskmgr.exe':           ('Task Manager',           'SYSTEM',        'NEUTRAL'),
    'regedit.exe':           ('Registry Editor',        'SYSTEM',        'NEUTRAL'),
    'mmc.exe':               ('Management Console',     'SYSTEM',        'NEUTRAL'),
    'notepad.exe':           ('Notepad',                'SYSTEM',        'NEUTRAL'),
    'calculator.exe':        ('Calculator',             'SYSTEM',        'NEUTRAL'),
    'calc.exe':              ('Calculator',             'SYSTEM',        'NEUTRAL'),
    'snippingtool.exe':      ('Snipping Tool',          'SYSTEM',        'NEUTRAL'),
    'snagit32.exe':          ('SnagIt',                 'SYSTEM',        'NEUTRAL'),
    'clockify.exe':          ('Clockify',               'PRODUCTIVE',    'PRODUCTIVE'),
    'toggl.exe':             ('Toggl',                  'PRODUCTIVE',    'PRODUCTIVE'),
    'anydesk.exe':           ('AnyDesk',                'SYSTEM',        'NEUTRAL'),
    'teamviewer.exe':        ('TeamViewer',             'SYSTEM',        'NEUTRAL'),
    'mobaxterm.exe':         ('MobaXterm',              'DEVELOPMENT',   'PRODUCTIVE'),
    'putty.exe':             ('PuTTY',                  'DEVELOPMENT',   'PRODUCTIVE'),
    'winscp.exe':            ('WinSCP',                 'DEVELOPMENT',   'PRODUCTIVE'),

    # ── Finance ──
    'zerodha kite.exe':      ('Zerodha Kite',           'FINANCE',       'NEUTRAL'),
    'groww.exe':             ('Groww',                  'FINANCE',       'NEUTRAL'),
    'thinkorswim.exe':       ('ThinkOrSwim',            'FINANCE',       'NEUTRAL'),
}

# Keyword-based fallback for unknown processes
KEYWORD_RULES = [
    (['code', 'ide', 'studio', 'dev', 'pycharm', 'eclipse', 'netbeans', 'antigravity', 'xcode'], 'DEVELOPMENT', 'PRODUCTIVE'),
    (['word', 'excel', 'sheet', 'docs', 'office', 'writer', 'calc', 'pages', 'keynote', 'numbers', 'notes'], 'PRODUCTIVE', 'PRODUCTIVE'),
    (['slack', 'teams', 'zoom', 'meet', 'discord', 'telegram', 'whatsapp'], 'COMMUNICATION','NEUTRAL'),
    (['game', 'steam', 'epic', 'play', 'minecraft', 'roblox'],              'GAMING',      'DISTRACTING'),
    (['vlc', 'media', 'player', 'music', 'spotify', 'netflix'],             'ENTERTAINMENT','DISTRACTING'),
    (['chrome', 'firefox', 'edge', 'brave', 'opera', 'safari', 'browser', 'arc'], 'BROWSER', 'NEUTRAL'),
    (['figma', 'photoshop', 'illustrator', 'blender', 'canva'],             'CREATIVE',    'PRODUCTIVE'),
    (['finance', 'trading', 'zerodha', 'groww', 'kite'],                    'FINANCE',     'NEUTRAL'),
]

# ─── Classifier ─────────────────────────────────────────────────────────────

def classify_app(process_name: str, window_title: str = ''):
    """Returns (app_display_name, category, productivity_label, confidence)"""
    proc_lower = process_name.lower().strip()
    title_lower = (window_title or '').lower().strip()

    # 1. Browser Windows: Dynamically inspect window title for work vs distraction
    BROWSER_PROCS = {
        'chrome.exe', 'google chrome', 'chrome',
        'safari',
        'msedge.exe', 'microsoft edge', 'edge',
        'firefox.exe', 'firefox',
        'brave.exe', 'brave browser', 'brave',
        'opera.exe', 'opera',
        'arc.exe', 'arc browser', 'arc',
        'vivaldi.exe', 'vivaldi'
    }
    if proc_lower in BROWSER_PROCS:
        browser_name = APP_MAP.get(proc_lower, ('Browser', 'BROWSER', 'NEUTRAL'))[0]

        # Specific YouTube title substring analysis
        if 'youtube' in title_lower:
            import re
            clean_yt = re.sub(r'^\(\d+\)\s*', '', title_lower).replace(' - youtube', '').strip()
            YOUTUBE_EDU = [
                'tutorial', 'course', 'lecture', 'learn', 'crash course', 'how to build',
                'how to code', 'how to create', 'how to install', 'how to use', 'how to',
                'guide', 'masterclass', 'python', 'javascript', 'typescript', 'react',
                'django', 'fastapi', 'algorithms', 'data structures', 'freecodecamp',
                'cs50', 'khan academy', 'mit opencourseware', 'stanford', 'calculus',
                'linear algebra', 'physics', 'documentation', 'coding', 'programming',
                'developer', 'devops', 'docker', 'sql'
            ]
            if any(edu in clean_yt for edu in YOUTUBE_EDU):
                return f"{browser_name} (YouTube Education)", 'EDUCATION', 'PRODUCTIVE', 0.95
            else:
                return f"{browser_name} (YouTube)", 'ENTERTAINMENT', 'DISTRACTING', 0.95

        # Check for distracting sites in window title
        DISTRACTING_TITLE_KEYWORDS = [
            'netflix', 'twitch', 'prime video', 'hulu', 'hotstar',
            'disney', 'instagram', 'facebook', 'twitter', 'x.com', 'reddit',
            'tiktok', 'pinterest', 'spotify', 'roblox', 'steam', 'game',
            'anime', 'manga', 'shorts', 'reels', '9gag', 'buzzfeed'
        ]
        if any(kw in title_lower for kw in DISTRACTING_TITLE_KEYWORDS):
            return f"{browser_name} (Entertainment)", 'ENTERTAINMENT', 'DISTRACTING', 0.95

        # Check for productive / dev / AI / work sites in window title
        PRODUCTIVE_TITLE_KEYWORDS = [
            'gemini', 'chatgpt', 'claude', 'deepseek', 'perplexity', 'copilot',
            'github', 'gitlab', 'stackoverflow', 'stack overflow', 'localhost',
            '127.0.0.1', 'docs', 'documentation', 'python', 'django', 'fastapi',
            'react', 'vue', 'angular', 'svelte', 'javascript', 'typescript',
            'mdn', 'w3schools', 'leetcode', 'hackerrank', 'kaggle', 'colab',
            'jupyter', 'aws', 'azure', 'cloud', 'jira', 'trello', 'asana',
            'notion', 'linear', 'figma', 'canva', 'medium', 'dev.to',
            'coursera', 'udemy', 'edx', 'khan academy', 'wikipedia', 'focusguard'
        ]
        if any(kw in title_lower for kw in PRODUCTIVE_TITLE_KEYWORDS):
            return f"{browser_name} (Work/Dev)", 'DEVELOPMENT', 'PRODUCTIVE', 0.95

        return browser_name, 'BROWSER', 'NEUTRAL', 0.8

    # 2. Exact match in APP_MAP
    if proc_lower in APP_MAP:
        name, cat, tier = APP_MAP[proc_lower]
        return name, cat, tier, 1.0

    # 3. Partial name match in map keys
    for key, (name, cat, tier) in APP_MAP.items():
        if key.replace('.exe', '') in proc_lower or proc_lower in key:
            return name, cat, tier, 0.9

    # 4. Keyword fallback on process + title
    combined = (proc_lower + ' ' + title_lower)
    for keywords, cat, tier in KEYWORD_RULES:
        if any(kw in combined for kw in keywords):
            display = process_name.replace('.exe', '').replace('64', '').title()
            return display, cat, tier, 0.7

    # 5. Default
    display = process_name.replace('.exe', '').replace('64', '').title()
    return display, 'SYSTEM', 'NEUTRAL', 0.5

# ─── Cross-Platform Window Detection ───────────────────────────────────────

# Helper / widget processes that should not be treated as the active app
_MAC_SKIP_SUBSTRINGS = (
    'widgetextension', 'widget', 'helper', 'agent', 'reporter', 'updater',
    'crashpad', 'nbagent', 'servicehub', 'notification', 'loginwindow',
    'dock', 'controlcenter', 'systemuiserver', 'spotlight', 'siri',
    'universalcontrol', 'coredatabase', 'windowmanager',
)

_WIN_SKIP_PROCS = {
    'applicationframehost.exe', 'shellexperiencehost.exe',
    'searchui.exe', 'searchapp.exe', 'lockapp.exe',
    'textinputhost.exe', 'startmenuexperiencehost.exe',
    'systemsettings.exe', 'dwm.exe', 'explorer.exe',  # explorer only when no title
}


def _mac_is_skip_app(name: str) -> bool:
    n = (name or '').lower().replace(' ', '')
    if not n:
        return True
    return any(s in n for s in _MAC_SKIP_SUBSTRINGS)


def _mac_frontmost_via_system_events():
    """Reliable frontmost app on macOS via System Events (works for GUI apps)."""
    script = '''
    tell application "System Events"
        set frontApp to first application process whose frontmost is true
        set appName to name of frontApp
        set winTitle to ""
        try
            if (count of windows of frontApp) > 0 then
                set winTitle to name of front window of frontApp
            end if
        end try
        return appName & "|||" & winTitle
    end tell
    '''
    res = subprocess.run(
        ['osascript', '-e', script],
        capture_output=True, text=True, timeout=3
    )
    if res.returncode != 0 or not res.stdout.strip():
        return None, None
    parts = res.stdout.strip().split('|||', 1)
    app_name = (parts[0] or '').strip()
    title = (parts[1] if len(parts) > 1 else '').strip() or app_name
    if _mac_is_skip_app(app_name):
        return None, None
    return app_name, title


def _mac_frontmost_via_lsappinfo():
    """Fallback using lsappinfo (may return widget extensions — filter them)."""
    res = subprocess.run(
        ['lsappinfo', 'info', '-only', 'name', 'front'],
        capture_output=True, text=True, timeout=2
    )
    match = re.search(r'"([^"]+)"', res.stdout or '')
    if not match:
        # Sometimes lsappinfo prints bare name
        bare = (res.stdout or '').strip()
        app_name = bare if bare and ' ' not in bare[:40] else None
        if not app_name:
            return None, None
    else:
        app_name = match.group(1).strip()

    if _mac_is_skip_app(app_name):
        return None, None

    title = app_name
    try:
        title_res = subprocess.run(
            ['osascript', '-e',
             f'tell application "System Events" to tell process "{app_name}" '
             f'to if (count of windows) > 0 then get name of front window'],
            capture_output=True, text=True, timeout=2
        )
        if title_res.returncode == 0 and title_res.stdout.strip():
            title = title_res.stdout.strip()
    except Exception:
        pass
    return app_name, title


def get_active_window():
    """Returns (process_name, exe_path, window_title, hwnd_or_id) of the foreground window.

    Supports Windows (win32) and macOS (darwin). Linux returns None.
    """
    if sys.platform == 'win32' and wintypes is not None:
        try:
            user32 = ctypes.windll.user32
            try:
                hdesk = user32.OpenInputDesktop(0, False, 0x01FF)
                if hdesk:
                    user32.SetThreadDesktop(hdesk)
            except Exception:
                pass

            hwnd = user32.GetForegroundWindow()
            if not hwnd:
                return None, None, None, None

            length = user32.GetWindowTextLengthW(hwnd)
            if length > 0:
                buff = ctypes.create_unicode_buffer(length + 1)
                user32.GetWindowTextW(hwnd, buff, length + 1)
                title = buff.value
            else:
                title = ''

            pid = wintypes.DWORD()
            user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
            if not pid.value:
                return None, None, None, None

            try:
                proc = psutil.Process(pid.value)
                process_name = proc.name()
                try:
                    exe_path = proc.exe()
                except (psutil.AccessDenied, psutil.NoSuchProcess):
                    exe_path = ''
            except (psutil.NoSuchProcess, psutil.AccessDenied):
                return None, None, None, None

            # Skip shell hosts with no meaningful title
            low = (process_name or '').lower()
            if low in _WIN_SKIP_PROCS and not title:
                return None, None, None, None
            if low in ('applicationframehost.exe', 'shellexperiencehost.exe',
                       'searchui.exe', 'searchapp.exe', 'lockapp.exe',
                       'textinputhost.exe', 'startmenuexperiencehost.exe'):
                return None, None, None, None

            return process_name, exe_path, title, hwnd

        except Exception as e:
            log.debug(f'win32 get_active_window error: {e}')
            return None, None, None, None

    elif sys.platform == 'darwin':
        # 1) System Events — most reliable for real GUI apps
        try:
            app_name, title = _mac_frontmost_via_system_events()
            if app_name:
                app_path = f"/Applications/{app_name}.app"
                if not os.path.isdir(app_path):
                    app_path = ''
                return app_name, app_path, title or app_name, None
        except Exception as e:
            log.debug(f'macOS System Events error: {e}')

        # 2) lsappinfo fallback
        try:
            app_name, title = _mac_frontmost_via_lsappinfo()
            if app_name:
                return app_name, f"/Applications/{app_name}.app", title or app_name, None
        except Exception as e:
            log.debug(f'macOS lsappinfo error: {e}')

        # 3) Last resort: known GUI processes via psutil (prefer ones with windows)
        try:
            preferred = [
                'google chrome', 'chrome', 'safari', 'firefox', 'microsoft edge',
                'code', 'cursor', 'terminal', 'iterm2', 'slack', 'discord',
                'spotify', 'figma', 'notion', 'finder', 'mail', 'notes',
                'xcode', 'intellij', 'pycharm', 'zoom', 'microsoft word',
                'microsoft excel', 'microsoft powerpoint', 'teams',
            ]
            running = []
            for proc in psutil.process_iter(['name']):
                p_name = (proc.info.get('name') or '').strip()
                if not p_name or _mac_is_skip_app(p_name):
                    continue
                running.append(p_name)
            for pref in preferred:
                for p_name in running:
                    if pref in p_name.lower():
                        return p_name, f"/Applications/{p_name}.app", p_name, None
        except Exception:
            pass

    return None, None, None, None

# ─── API Client ─────────────────────────────────────────────────────────────

class AgentAPIClient:
    def __init__(self):
        self.token = None
        self.session = requests.Session()
        self.session.headers['Content-Type'] = 'application/json'

    def authenticate(self):
        try:
            r = self.session.post(
                f'{API_BASE}/auth/token/',
                json={'username': USERNAME, 'password': PASSWORD},
                timeout=10
            )
            if r.status_code == 200:
                self.token = r.json()['access']
                self.session.headers['Authorization'] = f'Bearer {self.token}'
                log.info(f'✅ Authenticated as {USERNAME}')
                return True
            else:
                log.error(f'Auth failed: {r.status_code} {r.text}')
                return False
        except Exception as e:
            log.error(f'Auth error: {e}')
            return False

    def post_log(self, payload: dict):
        try:
            r = self.session.post(f'{API_BASE}/system/log/', json=payload, timeout=8)
            if r.status_code == 401:
                log.warning('Token expired, re-authenticating…')
                self.authenticate()
                r = self.session.post(f'{API_BASE}/system/log/', json=payload, timeout=8)
            return r.status_code in (200, 201)
        except Exception as e:
            log.debug(f'post_log error: {e}')
            return False

    def post_switch(self, payload: dict):
        try:
            r = self.session.post(f'{API_BASE}/system/switch/', json=payload, timeout=8)
            if r.status_code == 401:
                self.authenticate()
                r = self.session.post(f'{API_BASE}/system/switch/', json=payload, timeout=8)
            return r.status_code in (200, 201)
        except Exception as e:
            log.debug(f'post_switch error: {e}')
            return False

    def check_active_session(self) -> bool:
        gates = self.fetch_agent_gates()
        return gates.get('session_active', False)

    def fetch_agent_gates(self) -> dict:
        """Read focus + extension + break flags from dashboard summary."""
        out = {
            'session_active': False,
            'extension_connected': False,
            'on_break': False,
        }
        try:
            r = self.session.get(f'{API_BASE}/dashboard/summary/', timeout=6)
            if r.status_code == 401:
                self.authenticate()
                r = self.session.get(f'{API_BASE}/dashboard/summary/', timeout=6)
            if r.status_code == 200:
                data = r.json()
                out['session_active'] = bool(
                    data.get('is_session_active') or data.get('active_focus_session')
                )
                out['extension_connected'] = bool(data.get('extension_connected'))
                out['on_break'] = bool(data.get('on_break'))
        except Exception as e:
            log.debug(f'fetch_agent_gates error: {e}')
        return out

    def get_blocklist(self):
        try:
            r = self.session.get(f'{API_BASE}/focus/blocklist/', timeout=6)
            if r.status_code == 401:
                self.authenticate()
                r = self.session.get(f'{API_BASE}/focus/blocklist/', timeout=6)
            if r.status_code == 200:
                return r.json().get('blocked_apps', [])
        except Exception as e:
            log.debug(f'get_blocklist error: {e}')
        return []

# ─── Main Agent Loop ─────────────────────────────────────────────────────────

def run_agent():
    # Socket Mutex: Port 49556 guarantees single instance
    import socket
    try:
        _agent_lock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        _agent_lock.bind(('127.0.0.1', 49556))
        _agent_lock.listen(1)
    except socket.error:
        log.warning("[AGENT] Another instance of Desktop Agent is already running. Exiting duplicate.")
        sys.exit(0)

    log.info('=' * 55)
    log.info(' FocusGuard AI -- Cross-platform Desktop Agent  v1.0')
    log.info('=' * 55)
    log.info(f'  Backend : {API_BASE}')
    log.info(f'  User    : {USERNAME}')
    log.info(f'  Poll    : every {POLL_SECS}s')
    log.info('-' * 55)

    client = AgentAPIClient()
    if not client.authenticate():
        log.warning('[AUTH] Backend not ready yet. Desktop agent will retry automatically in background.')

    # Current session state
    current_proc   = None
    current_title  = None
    current_cat    = None
    session_start  = None
    current_log_id = None

    is_idle_state  = False
    session_active_state = None
    extension_connected_state = None
    on_break_state = False
    last_session_check = 0.0

    log.info('[AGENT] Desktop Agent running and on standby.')
    log.info('        Desktop tracking runs only while the Chrome extension is Connected.')

    custom_blocked_apps = []
    last_blocklist_fetch = 0.0

    while True:
        try:
            now_ts  = time.time()

            # ── Fetch User's Custom Blocklist Periodically ──
            if now_ts - last_blocklist_fetch >= 20.0 or not custom_blocked_apps:
                last_blocklist_fetch = now_ts
                fetched = client.get_blocklist()
                if fetched:
                    custom_blocked_apps = [str(a).strip().lower() for a in fetched]

            # ── Check extension + focus session gates ──
            if now_ts - last_session_check >= 3.0:
                last_session_check = now_ts
                gates = client.fetch_agent_gates()
                is_session_active = gates.get('session_active', False)
                ext_connected = gates.get('extension_connected', False)
                on_break_state = bool(gates.get('on_break'))

                if ext_connected != extension_connected_state:
                    extension_connected_state = ext_connected
                    if ext_connected:
                        log.info('[EXT] Chrome extension Connected.')
                    else:
                        log.info('[EXT] Chrome extension Standby.')

                if is_session_active != session_active_state:
                    session_active_state = is_session_active
                    if session_active_state:
                        log.info('[FOCUS] Focus Session is ACTIVE! Vision scoring and focus metrics enabled.')
                    else:
                        log.info('[FOCUS] Focus Session is IDLE.')

            # Pause desktop detection during an active break
            if on_break_state:
                if current_proc or session_start:
                    current_proc = None
                    session_start = None
                time.sleep(POLL_SECS)
                continue

            # Pause desktop detection during an active break
            if on_break_state:
                if current_proc or session_start:
                    current_proc = None
                    session_start = None
                time.sleep(POLL_SECS)
                continue

            # ── Check user inactivity (Idle Limit: 10 minutes) ──
            idle_secs = get_idle_duration_secs()
            now_iso = datetime.now(timezone.utc).isoformat()

            if idle_secs >= MAX_IDLE_SECS:
                if not is_idle_state:
                    log.warning(f'⏸️  User is IDLE ({int(idle_secs / 60)}m inactivity > 10m limit). Pausing tracking.')
                    is_idle_state = True
                    # Close previous active session if running
                    if current_proc and session_start:
                        duration = max(1, int(now_ts - session_start))
                        prev_app, prev_cat, prev_tier, _ = classify_app(current_proc, current_title or '')
                        client.post_log({
                            'process_name':       current_proc,
                            'app_name':           prev_app,
                            'window_title':       (current_title or '')[:512],
                            'exe_path':           '',
                            'category':           prev_cat,
                            'productivity_label': prev_tier,
                            'confidence_score':   1.0,
                            'started_at':         datetime.fromtimestamp(session_start, tz=timezone.utc).isoformat(),
                            'ended_at':           now_iso,
                            'duration_secs':      duration,
                        })
                        current_proc = None
                        session_start = None

                    # Log Idle period as neutral system activity
                    client.post_log({
                        'process_name':       'idle',
                        'app_name':           'System Idle / Away',
                        'window_title':       f'Inactive for >10m ({int(idle_secs / 60)}m total)',
                        'exe_path':           '',
                        'category':           'SYSTEM',
                        'productivity_label': 'NEUTRAL',
                        'confidence_score':   1.0,
                        'started_at':         now_iso,
                        'ended_at':           None,
                        'duration_secs':      int(idle_secs),
                    })

                time.sleep(POLL_SECS)
                continue

            if is_idle_state:
                log.info('▶️  User returned from idle state. Resuming active tracking.')
                is_idle_state = False
                current_proc = None
                session_start = None

            proc_name, exe_path, win_title, hwnd = get_active_window()

            # Skip system non-apps
            SKIP_PROCS = {'applicationframehost.exe', 'shellexperiencehost.exe',
                          'searchui.exe', 'searchapp.exe', 'lockapp.exe', ''}
            if not proc_name or proc_name.lower() in SKIP_PROCS:
                time.sleep(POLL_SECS)
                continue

            app_name, category, prod_label, confidence = classify_app(proc_name, win_title)

            # ── Desktop App Blocker Option (Focus Shield) ──
            is_blocked = (proc_name.lower() in custom_blocked_apps) or (prod_label == 'DISTRACTING')
            if APP_BLOCKER_ENABLED and session_active_state and is_blocked and sys.platform == 'win32' and wintypes is not None:
                try:
                    if hwnd and win32gui.IsWindow(hwnd):
                        win32gui.ShowWindow(hwnd, win32con.SW_MINIMIZE)
                        log.warning(f"🛡️ App Blocker Active: Minimized '{app_name}' ({proc_name}) during active focus session!")
                except Exception as e:
                    log.debug(f"Could not minimize window: {e}")

            now_iso = datetime.now(timezone.utc).isoformat()
            now_ts  = time.time()

            # Detect a change (new process or window title changed significantly)
            title_changed = (win_title or '')[:80] != (current_title or '')[:80]
            proc_changed  = proc_name.lower() != (current_proc or '').lower()

            if proc_changed or (title_changed and proc_changed is False):
                # ── Close previous session ──────────────────────────────────
                if current_proc and session_start:
                    duration = max(1, int(now_ts - session_start))
                    prev_app, prev_cat, prev_tier, _ = classify_app(current_proc, current_title or '')

                    # Post final log for ended session
                    client.post_log({
                        'process_name':      current_proc,
                        'app_name':          prev_app,
                        'window_title':      (current_title or '')[:512],
                        'exe_path':          '',
                        'category':          prev_cat,
                        'productivity_label': prev_tier,
                        'confidence_score':  confidence,
                        'started_at':        datetime.fromtimestamp(session_start, tz=timezone.utc).isoformat(),
                        'ended_at':          now_iso,
                        'duration_secs':     duration,
                    })

                    # Post switch event (only on process change to avoid noise)
                    if proc_changed and current_proc:
                        client.post_switch({
                            'from_process':  current_proc,
                            'from_app':      prev_app,
                            'from_title':    (current_title or '')[:512],
                            'from_category': prev_cat,
                            'to_process':    proc_name,
                            'to_app':        app_name,
                            'to_title':      win_title[:512] if win_title else '',
                            'to_category':   category,
                            'switched_at':   now_iso,
                        })
                        log.info(f'  🔄 {prev_app} → {app_name}  [{prev_cat} → {category}]')

                # ── Start new session ───────────────────────────────────────
                current_proc  = proc_name
                current_title = win_title
                current_cat   = category
                session_start = now_ts

                prod_icon = {'PRODUCTIVE': '🟢', 'NEUTRAL': '🟡', 'DISTRACTING': '🔴'}.get(prod_label, '⚪')
                log.info(f'{prod_icon} Active: {app_name} ({proc_name}) · [{category}]')
                if win_title:
                    log.info(f'   📝 "{win_title[:80]}"')

                # Immediately announce active session to backend
                client.post_log({
                    'process_name':       proc_name,
                    'app_name':           app_name,
                    'window_title':       (win_title or '')[:512],
                    'exe_path':           exe_path or '',
                    'category':           category,
                    'productivity_label': prod_label,
                    'confidence_score':   confidence,
                    'started_at':         datetime.fromtimestamp(session_start, tz=timezone.utc).isoformat(),
                    'ended_at':           None,
                    'duration_secs':      1,
                })

            else:
                # ── Heartbeat: keep session alive by posting partial duration ──
                if session_start:
                    duration = max(1, int(now_ts - session_start))
                    client.post_log({
                        'process_name':       proc_name,
                        'app_name':           app_name,
                        'window_title':       (win_title or '')[:512],
                        'exe_path':           exe_path or '',
                        'category':           category,
                        'productivity_label': prod_label,
                        'confidence_score':   confidence,
                        'started_at':         datetime.fromtimestamp(session_start, tz=timezone.utc).isoformat(),
                        'ended_at':           None,
                        'duration_secs':      duration,
                    })

            time.sleep(POLL_SECS)

        except KeyboardInterrupt:
            log.info('')
            log.info('⏹  Agent stopped by user.')
            break
        except Exception as e:
            log.error(f'Agent loop error: {e}')
            time.sleep(POLL_SECS * 2)


if __name__ == '__main__':
    import argparse
    import subprocess

    parser = argparse.ArgumentParser(description='FocusGuard AI Desktop Agent')
    parser.add_argument('--no-vision', action='store_true', help='Disable automatic Vision Attention Tracker launch')
    parser.add_argument('--headless-vision', action='store_true', help='Run vision tracker headlessly in background')
    parser.add_argument('--test-once', action='store_true', help='Perform single test scan of active window and exit')
    cli_args = parser.parse_args()

    if getattr(cli_args, 'test_once', False):
        proc_name, exe_path, title, _ = get_active_window()
        idle_secs = get_idle_duration_secs()
        if proc_name:
            app_name, cat, tier, conf = classify_app(proc_name, title or '')
            print(f"[TEST SUCCESS] Platform: {sys.platform}")
            print(f"  Raw Process:   {proc_name}")
            print(f"  App Name:      {app_name}")
            print(f"  Window Title:  {title}")
            print(f"  Category:      {cat}")
            print(f"  Tier:          {tier}")
            print(f"  Confidence:    {conf}")
            print(f"  Idle Duration: {idle_secs:.2f}s")
        else:
            print(f"[TEST NOTICE] Platform: {sys.platform} - No active foreground window detected. Idle: {idle_secs:.2f}s")
        sys.exit(0)

    v_proc = None
    if not cli_args.no_vision:
        vision_cmd = [sys.executable, 'vision_tracker.py']
        if cli_args.headless_vision:
            vision_cmd.append('--headless')
        log.info('[STARTUP] Automatically launching Vision Attention Tracker (DeepFace / OpenCV)...')

        try:
            v_proc = subprocess.Popen(vision_cmd)
        except Exception as e:
            log.warning(f'Could not auto-start vision tracker: {e}')

    try:
        run_agent()
    finally:
        if v_proc:
            log.info('Stopping vision tracker...')
            try:
                v_proc.terminate()
            except Exception:
                pass


