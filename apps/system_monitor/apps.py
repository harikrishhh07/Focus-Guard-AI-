import os
import sys
import subprocess
from pathlib import Path
from django.apps import AppConfig


class SystemMonitorConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'apps.system_monitor'

    def ready(self):
        """
        Automatically launches the Vision Attention Tracker when the Django application boots up.
        """
        is_runserver = 'runserver' in sys.argv
        is_main_worker = os.environ.get('RUN_MAIN') == 'true' or '--noreload' in sys.argv

        if is_runserver and is_main_worker:
            try:
                from .agent_launcher import ensure_agents_running
                ensure_agents_running()
                print("[FocusGuard] Background Agents (Desktop & Vision) supervisor active!")
            except Exception as e:
                print(f"[FocusGuard] Agents auto-start notice: {e}")

