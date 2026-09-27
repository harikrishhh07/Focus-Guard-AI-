"""
CSV Data Export View for FocusGuard AI
Generates a downloadable CSV containing complete session and telemetry history.
"""
import csv
from io import StringIO
from datetime import datetime
from django.http import HttpResponse
from rest_framework.views import APIView
from rest_framework.permissions import IsAuthenticated
from django.utils import timezone
from django.db.models import Sum

from apps.focus_sessions.models import FocusSession
from apps.system_monitor.models import SystemAppLog
from apps.browsing.models import BrowsingLog


class CSVExportView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        user = request.user
        date_from_str = request.query_params.get('date_from')
        date_to_str = request.query_params.get('date_to')

        today = timezone.localdate()
        date_to = today
        if date_to_str:
            try:
                date_to = datetime.strptime(date_to_str, '%Y-%m-%d').date()
            except ValueError:
                date_to = today

        date_from = date_to - timezone.timedelta(days=30)
        if date_from_str:
            try:
                date_from = datetime.strptime(date_from_str, '%Y-%m-%d').date()
            except ValueError:
                pass

        # Build CSV in memory
        output = StringIO()
        writer = csv.writer(output)

        # ── Title & Metadata ──
        writer.writerow(['FOCUSGUARD AI - PRODUCTIVITY & SESSION REPORT'])
        writer.writerow(['Generated At', timezone.now().strftime('%Y-%m-%d %H:%M:%S UTC')])
        writer.writerow(['User', user.username])
        writer.writerow(['Date Range', f"{date_from} to {date_to}"])
        writer.writerow([])

        # ── Section 1: Focus Sessions ──
        writer.writerow(['--- FOCUS SESSIONS ---'])
        writer.writerow([
            'Session ID', 'Date', 'Type', 'Start Time', 'End Time',
            'Duration (Mins)', 'Productive (Mins)', 'Distracted (Mins)',
            'Context Switches', 'Productivity Score (%)', 'Status'
        ])

        sessions = FocusSession.objects.filter(
            user=user, start_time__date__gte=date_from, start_time__date__lte=date_to
        ).order_by('-start_time')

        for s in sessions:
            st = s.start_time.strftime('%Y-%m-%d %H:%M:%S') if s.start_time else ''
            et = s.end_time.strftime('%Y-%m-%d %H:%M:%S') if s.end_time else 'In Progress'
            p_min = round((s.productive_secs or 0) / 60, 1)
            d_min = round((s.distracted_secs or 0) / 60, 1)
            writer.writerow([
                s.id,
                s.start_time.strftime('%Y-%m-%d') if s.start_time else '',
                s.session_type,
                st,
                et,
                s.actual_duration_mins or 1,
                p_min,
                d_min,
                s.switches_count or 0,
                f"{round(s.productivity_score or 100, 1)}%",
                s.status
            ])

        writer.writerow([])

        # ── Section 2: Top Desktop Applications ──
        writer.writerow(['--- TOP DESKTOP APPLICATIONS ---'])
        writer.writerow(['Application Name', 'Process Name', 'Category', 'Productivity Tier', 'Total Minutes Spent'])

        sys_apps = (
            SystemAppLog.objects.filter(
                user=user, started_at__date__gte=date_from, started_at__date__lte=date_to
            )
            .values('app_name', 'process_name', 'category', 'productivity_label')
            .annotate(total_secs=Sum('duration_secs'))
            .order_by('-total_secs')[:25]
        )

        for a in sys_apps:
            mins = round((a['total_secs'] or 0) / 60, 1)
            writer.writerow([
                a['app_name'],
                a['process_name'],
                a['category'],
                a['productivity_label'],
                mins
            ])

        writer.writerow([])

        # ── Section 3: Top Web Domains ──
        writer.writerow(['--- TOP BROWSER DOMAINS ---'])
        writer.writerow(['Domain', 'Category', 'Productivity Tier', 'Total Minutes Spent'])

        web_sites = (
            BrowsingLog.objects.filter(
                user=user, visited_at__date__gte=date_from, visited_at__date__lte=date_to
            )
            .values('domain', 'category', 'productivity_label')
            .annotate(total_secs=Sum('time_spent_secs'))
            .order_by('-total_secs')[:25]
        )

        for w in web_sites:
            mins = round((w['total_secs'] or 0) / 60, 1)
            writer.writerow([
                w['domain'],
                w['category'],
                w['productivity_label'],
                mins
            ])

        filename = f"focusguard_report_{date_from}_{date_to}.csv"
        response = HttpResponse(output.getvalue(), content_type='text/csv; charset=utf-8')
        response['Content-Disposition'] = f'attachment; filename="{filename}"'
        return response
