"""
FocusGuard AI — Agent Launcher & Supervisor
===========================================
Ensures both the Desktop Agent (desktop_agent.py) and the Vision Tracker (vision_tracker.py)
are spawned and running in the background when Django boots or when a focus session starts.
Each agent is protected by a socket mutex port (49555 for vision, 49556 for desktop)
so multiple invocations never create duplicate processes.
"""

import os
import sys
import socket
import subprocess
import logging
from pathlib import Path

log = logging.getLogger('focusguard-launcher')

VISION_MUTEX_PORT = 49555
DESKTOP_MUTEX_PORT = 49556


def is_port_in_use(port: int) -> bool:
    """Returns True if the mutex port is already bound by an active agent process."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(0.4)
        try:
            s.bind(('127.0.0.1', port))
            return False  # Port was free
        except socket.error:
            return True   # Port is in use, agent is running!


def get_base_dir() -> Path:
    return Path(__file__).resolve().parent.parent.parent


def start_vision_agent():
    if is_port_in_use(VISION_MUTEX_PORT):
        log.info("Vision Tracker is already active on port %d", VISION_MUTEX_PORT)
        return

    base_dir = get_base_dir()
    script = base_dir / 'vision_tracker.py'
    if not script.exists():
        log.warning("vision_tracker.py not found at %s", script)
        return

    cmd = [sys.executable, str(script), '--headless']
    kwargs = {}
    if os.name == 'nt':
        kwargs['creationflags'] = subprocess.CREATE_NEW_PROCESS_GROUP
    else:
        kwargs['start_new_session'] = True

    try:
        subprocess.Popen(
            cmd,
            cwd=str(base_dir),
            **kwargs
        )
        log.info("[FocusGuard] Spawned Vision Tracker (headless)")
    except Exception as e:
        log.error("Failed to spawn vision_tracker: %s", e)


def start_desktop_agent():
    if is_port_in_use(DESKTOP_MUTEX_PORT):
        log.info("Desktop Agent is already active on port %d", DESKTOP_MUTEX_PORT)
        return

    base_dir = get_base_dir()
    script = base_dir / 'desktop_agent.py'
    if not script.exists():
        log.warning("desktop_agent.py not found at %s", script)
        return

    cmd = [sys.executable, str(script)]
    kwargs = {}
    if os.name == 'nt':
        kwargs['creationflags'] = subprocess.CREATE_NEW_PROCESS_GROUP
    else:
        kwargs['start_new_session'] = True

    try:
        subprocess.Popen(
            cmd,
            cwd=str(base_dir),
            **kwargs
        )
        log.info("[FocusGuard] Spawned Desktop Agent")
    except Exception as e:
        log.error("Failed to spawn desktop_agent: %s", e)


def ensure_agents_running():
    """Starts both Desktop Agent and Vision Agent if not already running."""
    try:
        start_desktop_agent()
    except Exception as e:
        log.warning("Error launching desktop agent: %s", e)

    try:
        start_vision_agent()
    except Exception as e:
        log.warning("Error launching vision agent: %s", e)
