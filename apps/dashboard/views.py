from rest_framework import generics, permissions
from rest_framework.response import Response
from django.utils import timezone
from datetime import datetime
from django.core.cache import cache
from django.db.models import Sum, Count
from apps.browsing.models import BrowsingLog, SwitchEvent
from apps.system_monitor.models import SystemAppLog, SystemSwitchEvent
from apps.focus_sessions.models import FocusSession
from apps.users.models import Goal
from apps.ai_engine.models import AIInsight
from apps.ai_engine.serializers import AIInsightSerializer
import socket


def _is_desktop_agent_running() -> bool:
    """Returns True if the desktop agent mutex port (49556) is bound, meaning agent is active."""
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.settimeout(0.3)
            s.bind(('127.0.0.1', 49556))
            return False  # bound successfully → port was free → agent NOT running
    except OSError:
        return True   # port already in use → agent IS running


def format_duration(total_secs: float) -> str:
    """Formats seconds into human friendly time: e.g. 45s, 12m 30s, 1h 15m"""
    s = max(0, int(round(total_secs or 0)))
    if s < 60:
        return f"{s}s"
    mins = s // 60
    rem_s = s % 60
    if mins < 60:
        return f"{mins}m {rem_s}s" if rem_s > 0 else f"{mins}m"
    hrs = mins // 60
    rem_m = mins % 60
    return f"{hrs}h {rem_m}m" if rem_m > 0 else f"{hrs}h"


class DashboardSummaryView(generics.GenericAPIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        user = request.user
        today = timezone.localdate()
        now_dt = timezone.now()

        # ── Browser activity (from Chrome Extension) ──────────────────────
        browse_logs = BrowsingLog.objects.filter(user=user, visited_at__date=today)
        if not browse_logs.exists():
            from datetime import timedelta as _td
            browse_logs = BrowsingLog.objects.filter(user=user, visited_at__gte=now_dt - _td(days=7))
        browse_total = browse_logs.aggregate(s=Sum('time_spent_secs'))['s'] or 0
        browse_prod  = browse_logs.filter(productivity_label='PRODUCTIVE').aggregate(s=Sum('time_spent_secs'))['s'] or 0
        browse_dist  = browse_logs.filter(productivity_label='DISTRACTING').aggregate(s=Sum('time_spent_secs'))['s'] or 0

        # ── System app activity (from Desktop Agent) ──────────────────────
        sys_logs   = SystemAppLog.objects.filter(user=user, started_at__date=today)
        if not sys_logs.exists():
            from datetime import timedelta as _td
            sys_logs = SystemAppLog.objects.filter(user=user, started_at__gte=now_dt - _td(days=7))
        sys_total  = sys_logs.aggregate(s=Sum('duration_secs'))['s'] or 0
        sys_prod   = sys_logs.filter(productivity_label='PRODUCTIVE').aggregate(s=Sum('duration_secs'))['s'] or 0
        sys_dist   = sys_logs.filter(productivity_label='DISTRACTING').aggregate(s=Sum('duration_secs'))['s'] or 0

        # Combined totals today
        total_secs = browse_total + sys_total
        prod_secs  = browse_prod  + sys_prod
        dist_secs  = browse_dist  + sys_dist
        neut_secs  = max(0, total_secs - prod_secs - dist_secs)

        # Auto-complete any stale focus sessions from previous days
        FocusSession.objects.filter(
            user=user,
            status='ACTIVE',
            start_time__date__lt=today
        ).update(status='COMPLETED', end_time=now_dt)

        if total_secs > 0:
            # prod_pct = ratio of purely PRODUCTIVE secs out of all tracked time.
            # NEUTRAL apps (WhatsApp, Spotify, File Explorer) reduce this score
            # proportionally — you only get 100% if ALL tracked time is productive.
            prod_pct = round(min(100.0, (prod_secs / total_secs) * 100), 1)
            dist_pct = round(min(100.0, (dist_secs / total_secs) * 100), 1)
        else:
            prod_pct = None
            dist_pct = 0.0

        # ── Category breakdown (system apps + browsing) ───────────────────
        CATEGORIES = [
            'PRODUCTIVE', 'DEVELOPMENT', 'EDUCATION', 'CREATIVE',
            'COMMUNICATION', 'FINANCE', 'SYSTEM', 'NEWS_READING',
            'ENTERTAINMENT', 'SOCIAL_MEDIA', 'GAMING', 'SHOPPING', 'BROWSER'
        ]
        category_totals = {}
        for c in CATEGORIES:
            b_secs = browse_logs.filter(category=c).aggregate(s=Sum('time_spent_secs'))['s'] or 0
            s_secs = sys_logs.filter(category=c).aggregate(s=Sum('duration_secs'))['s'] or 0
            total_min = round((b_secs + s_secs) / 60, 1)
            if total_min > 0:
                category_totals[c] = total_min

        # ── Top system apps ────────────────────────────────────────────────
        top_apps = list(
            sys_logs.values('app_name', 'process_name', 'category', 'productivity_label')
            .annotate(total_secs=Sum('duration_secs'))
            .order_by('-total_secs')[:12]
        )

        # ── Top browser sites ──────────────────────────────────────────────
        top_sites = list(
            browse_logs.values('domain', 'category', 'productivity_label')
            .annotate(total_secs=Sum('time_spent_secs'))
            .order_by('-total_secs')[:10]
        )

        # ── Context Switches ───────────────────────────────────────────────
        browser_switches = SwitchEvent.objects.filter(user=user, switched_at__date=today)
        browser_switch_count = browser_switches.count()

        sys_switches = SystemSwitchEvent.objects.filter(user=user, switched_at__date=today)
        sys_switch_count = sys_switches.count()
        total_switches = browser_switch_count + sys_switch_count

        top_transitions = list(
            sys_switches.values('from_app', 'to_app', 'from_category', 'to_category')
            .annotate(count=Count('id'))
            .order_by('-count')[:5]
        )

        recent_switches = list(
            sys_switches.values('from_app', 'from_category', 'to_app', 'to_category', 'switched_at')
            .order_by('-switched_at')[:10]
        )
        for r in recent_switches:
            if r.get('switched_at'):
                r['switched_at'] = r['switched_at'].isoformat()

        # ── Currently active app ───────────────────────────────────────────
        active_sys = (
            sys_logs.filter(ended_at__isnull=True).order_by('-started_at').first()
            or sys_logs.order_by('-started_at', '-id').first()
        )
        active_app = None
        if active_sys:
            active_app = {
                'app_name': active_sys.app_name,
                'process_name': active_sys.process_name,
                'window_title': active_sys.window_title,
                'category': active_sys.category,
                'productivity_label': active_sys.productivity_label,
            }

        # ── Active focus session (Isolated to current session only) ─────────
        active_focus = FocusSession.objects.filter(user=user, status='ACTIVE', start_time__date=today).order_by('-start_time').first()
        active_focus_data = None
        curr_prod_secs = 0
        curr_dist_secs = 0
        curr_switches = 0
        curr_score = 100.0

        if active_focus:
            # Telemetry strictly generated during current session
            curr_b_prod = browse_logs.filter(visited_at__gte=active_focus.start_time, productivity_label='PRODUCTIVE').aggregate(s=Sum('time_spent_secs'))['s'] or 0
            curr_b_dist = browse_logs.filter(visited_at__gte=active_focus.start_time, productivity_label='DISTRACTING').aggregate(s=Sum('time_spent_secs'))['s'] or 0
            curr_s_prod = sys_logs.filter(started_at__gte=active_focus.start_time, productivity_label='PRODUCTIVE').aggregate(s=Sum('duration_secs'))['s'] or 0
            curr_s_dist = sys_logs.filter(started_at__gte=active_focus.start_time, productivity_label='DISTRACTING').aggregate(s=Sum('duration_secs'))['s'] or 0

            # Adjust for the currently-open system app whose duration_secs may be
            # stale (desktop agent updates it every few seconds).
            open_sys = sys_logs.filter(ended_at__isnull=True).order_by('-started_at').first()
            if open_sys:
                # Real elapsed for this app since session started (or since it started, whichever is later)
                effective_start = max(open_sys.started_at, active_focus.start_time)
                real_elapsed = max(0, int((now_dt - effective_start).total_seconds()))
                stale_duration = open_sys.duration_secs or 0
                # Credit the delta between real elapsed and what's already counted
                delta = max(0, real_elapsed - stale_duration)
                if delta > 0:
                    if open_sys.productivity_label == 'PRODUCTIVE':
                        curr_s_prod += delta
                    elif open_sys.productivity_label == 'DISTRACTING':
                        curr_s_dist += delta

            curr_switches = browser_switches.filter(switched_at__gte=active_focus.start_time).count() + sys_switches.filter(switched_at__gte=active_focus.start_time).count()

            curr_prod_secs = curr_b_prod + curr_s_prod
            curr_dist_secs = curr_b_dist + curr_s_dist
            curr_tot_secs = curr_prod_secs + curr_dist_secs

            # Use the full system+browser total for this session as denominator
            # so NEUTRAL time (WhatsApp, Spotify etc.) properly reduces the score.
            curr_sys_tot = sys_logs.filter(started_at__gte=active_focus.start_time).aggregate(s=Sum('duration_secs'))['s'] or 0
            # Also credit the open app's real elapsed to the total
            if open_sys:
                effective_start = max(open_sys.started_at, active_focus.start_time)
                real_elapsed = max(0, int((now_dt - effective_start).total_seconds()))
                stale_duration = open_sys.duration_secs or 0
                curr_sys_tot += max(0, real_elapsed - stale_duration)
            curr_br_tot  = browse_logs.filter(visited_at__gte=active_focus.start_time).aggregate(s=Sum('time_spent_secs'))['s'] or 0
            curr_full_tot = curr_sys_tot + curr_br_tot

            if curr_full_tot > 0:
                curr_score = round(min(100.0, (curr_prod_secs / curr_full_tot) * 100), 1)
            elif curr_tot_secs > 0:
                curr_score = round(min(100.0, (curr_prod_secs / curr_tot_secs) * 100), 1)
            else:
                curr_score = 100.0

            active_focus_data = {
                'id': active_focus.id,
                'session_type': active_focus.session_type,
                'planned_duration_mins': active_focus.planned_duration_mins,
                'start_time': active_focus.start_time.isoformat(),
                'switches': curr_switches,
                'productive_secs': curr_prod_secs,
                'distracted_secs': curr_dist_secs,
                'productive_formatted': format_duration(curr_prod_secs),
                'distracted_formatted': format_duration(curr_dist_secs),
                'productivity_score': curr_score,
            }

        # ── Today's Separate Focus Sessions ───────────────────────────────
        today_sessions = list(
            FocusSession.objects.filter(user=user, start_time__date=today)
            .order_by('start_time')
            .values('id', 'session_type', 'start_time', 'end_time', 'actual_duration_mins',
                    'productive_secs', 'distracted_secs', 'switches_count',
                    'productivity_score', 'focus_score', 'status')
        )
        for s in today_sessions:
            if s.get('start_time'): s['start_time'] = s['start_time'].isoformat()
            if s.get('end_time'): s['end_time'] = s['end_time'].isoformat()
            s['productive_formatted'] = format_duration(s.get('productive_secs', 0))
            s['distracted_formatted'] = format_duration(s.get('distracted_secs', 0))

        # ── Latest AI Insight ──────────────────────────────────────────────
        insight = AIInsight.objects.filter(user=user, date_analyzed=today).order_by('-generated_at').first()
        insight_data = AIInsightSerializer(insight).data if insight else None

        # ── User goals ─────────────────────────────────────────────────────
        goals = list(Goal.objects.filter(user=user, status='ACTIVE').values(
            'id', 'title', 'target_focus_hours', 'current_focus_hours', 'target_date')[:4])

        # Active vs Cumulative Selection for Top Dashboard Cards
        from apps.focus_sessions.views import get_active_break
        break_info = get_active_break(user)
        on_break = bool(break_info)

        # During break, focus + shield are paused for clients
        is_active = bool(active_focus) and not on_break
        if on_break:
            active_focus_data = None

        card_prod_secs = curr_prod_secs if is_active else prod_secs
        card_dist_secs = curr_dist_secs if is_active else dist_secs
        card_switches  = curr_switches if is_active else total_switches
        # Use the full tracked secs (incl. neutral) as the display total
        card_tot_secs  = (curr_full_tot if is_active else total_secs) or (card_prod_secs + card_dist_secs)

        if is_active:
            raw_prod_pct = curr_score  # already accounts for neutral via curr_full_tot
            switch_penalty = min(30, round(card_switches * 1.5, 1))
            card_score       = max(0.0, min(100.0, round(raw_prod_pct - switch_penalty, 1)))
            final_focus_score = card_score
        else:
            if total_secs > 0 and prod_pct is not None:
                raw_prod_pct = prod_pct
                switch_penalty = min(30, round(card_switches * 1.5, 1))
                card_score = max(0.0, min(100.0, round(raw_prod_pct - switch_penalty, 1)))
                final_focus_score = round(insight_data['focus_score'], 1) if insight_data and insight_data.get('focus_score') else card_score
            else:
                raw_prod_pct = None
                card_score = None
                final_focus_score = None

        return Response({
            'date': str(today),
            'is_session_active': is_active,
            'on_break': on_break,
            'break': break_info,
            # Top Card Primary Metrics (Real-Time Current Session or Today Total)
            'productive_secs':         card_prod_secs,
            'distracted_secs':         card_dist_secs,
            'total_secs':              card_tot_secs,
            'productive_formatted':    format_duration(card_prod_secs),
            'distracted_formatted':    format_duration(card_dist_secs),
            'total_screen_time_hours': round(card_tot_secs / 3600, 2),
            'productive_hours':        round(card_prod_secs / 3600, 2),
            'distracted_hours':        round(card_dist_secs / 3600, 2),
            'productive_pct':          raw_prod_pct,
            'distracting_pct':         dist_pct if raw_prod_pct is not None else 0.0,
            # productivity_score is already switch-penalized: lower score = more switching
            'productivity_score':      card_score,
            'focus_score':             final_focus_score,
            'raw_productive_pct':      raw_prod_pct,
            'total_switches':          card_switches,
            # Today Cumulative Totals for reference
            'cumulative_today': {
                'total_secs': total_secs,
                'productive_secs': prod_secs,
                'distracted_secs': dist_secs,
                'switches': total_switches,
                'productive_formatted': format_duration(prod_secs),
                'distracted_formatted': format_duration(dist_secs),
                'score': prod_pct,
            },
            # System apps
            'top_apps':       top_apps,
            'system_total_secs': sys_total,
            # Browser
            'top_sites':      top_sites,
            'browser_total_secs': browse_total,
            # Categories
            'category_breakdown': category_totals,
            # Switches
            'browser_switches':   browser_switch_count,
            'system_switches':    sys_switch_count,
            'top_transitions':    top_transitions,
            'recent_switches':    recent_switches,
            # Live state
            'active_app':         active_app,
            'active_focus_session': active_focus_data,
            'today_sessions':     today_sessions,
            # Extension — only "connected" while heartbeat cache is fresh
            'extension_connected': bool(cache.get(f"ext_active_{user.id}")),
            'extension_recent': bool(cache.get(f"ext_active_{user.id}")),
            # Desktop Agent — running if mutex port 49556 is bound
            'desktop_agent_running': _is_desktop_agent_running(),
            # AI
            'ai_insight': insight_data,
            'goals':      goals,
        })


class DateReportView(generics.GenericAPIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        user = request.user
        date_str = request.query_params.get('date')
        if not date_str:
            target_date = timezone.localdate()
        else:
            try:
                target_date = datetime.strptime(date_str, '%Y-%m-%d').date()
            except ValueError:
                return Response({"error": "Invalid date format, use YYYY-MM-DD"}, status=400)

        # Browsing & System telemetry for that date
        b_logs = BrowsingLog.objects.filter(user=user, visited_at__date=target_date)
        b_total = b_logs.aggregate(s=Sum('time_spent_secs'))['s'] or 0
        b_prod  = b_logs.filter(productivity_label='PRODUCTIVE').aggregate(s=Sum('time_spent_secs'))['s'] or 0
        b_dist  = b_logs.filter(productivity_label='DISTRACTING').aggregate(s=Sum('time_spent_secs'))['s'] or 0

        s_logs = SystemAppLog.objects.filter(user=user, started_at__date=target_date)
        s_total = s_logs.aggregate(s=Sum('duration_secs'))['s'] or 0
        s_prod  = s_logs.filter(productivity_label='PRODUCTIVE').aggregate(s=Sum('duration_secs'))['s'] or 0
        s_dist  = s_logs.filter(productivity_label='DISTRACTING').aggregate(s=Sum('duration_secs'))['s'] or 0

        b_switches = SwitchEvent.objects.filter(user=user, switched_at__date=target_date).count()
        s_switches = SystemSwitchEvent.objects.filter(user=user, switched_at__date=target_date).count()
        total_switches = b_switches + s_switches

        total_secs = b_total + s_total
        prod_secs = b_prod + s_prod
        dist_secs = b_dist + s_dist
        neut_secs = max(0, total_secs - prod_secs - dist_secs)

        if total_secs > 0:
            prod_pct = round(min(100.0, (prod_secs / total_secs) * 100), 1)
            dist_pct = round(min(100.0, (dist_secs / total_secs) * 100), 1)
        else:
            prod_pct = None
            dist_pct = 0.0

        # Verdict calculation
        if total_secs == 0:
            verdict = 'NO_DATA'
            verdict_badge = 'NO ACTIVITY'
            verdict_reason = 'No active telemetry recorded for this date.'
        elif dist_secs == 0 or (prod_pct >= 60.0 and total_switches < 40):
            verdict = 'PRODUCTIVE'
            verdict_badge = 'HIGHLY PRODUCTIVE'
            verdict_reason = f'Excellent concentration! {format_duration(prod_secs)} dedicated to productive workflows with minimal attention fragmentation ({total_switches} switches).'
        elif dist_pct > prod_pct or total_switches >= 40:
            verdict = 'DISTRACTED'
            verdict_badge = 'DISTRACTED'
            verdict_reason = f'Significant attention leakage detected. {format_duration(dist_secs)} spent on distracting activities ({dist_pct}%) disrupted deep work flow.'
        else:
            verdict = 'BALANCED'
            verdict_badge = 'MODERATE FOCUS'
            verdict_reason = f'Moderate work state. Productive time ({format_duration(prod_secs)}) was achieved alongside {format_duration(dist_secs)} distraction and {total_switches} context switches.'

        # Separate sessions for that day
        sessions = list(
            FocusSession.objects.filter(user=user, start_time__date=target_date)
            .order_by('start_time')
            .values('id', 'session_type', 'start_time', 'end_time', 'actual_duration_mins',
                    'productive_secs', 'distracted_secs', 'switches_count',
                    'productivity_score', 'focus_score', 'status')
        )
        for s in sessions:
            if s.get('start_time'): s['start_time'] = s['start_time'].isoformat()
            if s.get('end_time'): s['end_time'] = s['end_time'].isoformat()
            s['productive_formatted'] = format_duration(s.get('productive_secs', 0))
            s['distracted_formatted'] = format_duration(s.get('distracted_secs', 0))

        # Top apps & sites
        top_apps = list(s_logs.values('app_name', 'category', 'productivity_label').annotate(total_secs=Sum('duration_secs')).order_by('-total_secs')[:8])
        top_sites = list(b_logs.values('domain', 'category', 'productivity_label').annotate(total_secs=Sum('time_spent_secs')).order_by('-total_secs')[:8])

        # Insight
        insight = AIInsight.objects.filter(user=user, date_analyzed=target_date).order_by('-generated_at').first()

        return Response({
            'date': str(target_date),
            'verdict': verdict,
            'verdict_badge': verdict_badge,
            'verdict_reason': verdict_reason,
            'productivity_score': prod_pct,
            'distraction_score': dist_pct,
            'total_screen_time_hours': round(total_secs / 3600, 2),
            'productive_hours': round(prod_secs / 3600, 2),
            'distracted_hours': round(dist_secs / 3600, 2),
            'productive_secs': prod_secs,
            'distracted_secs': dist_secs,
            'productive_formatted': format_duration(prod_secs),
            'distracted_formatted': format_duration(dist_secs),
            'total_switches': total_switches,
            'sessions': sessions,
            'top_apps': top_apps,
            'top_sites': top_sites,
            'ai_insight': AIInsightSerializer(insight).data if insight else None,
            'user_name': (user.get_full_name() or user.username or 'User').strip(),
            'username': user.username,
            'email': user.email or '',
            'generated_at': timezone.localtime().isoformat(),
            'generated_at_display': timezone.localtime().strftime('%d %b %Y · %I:%M %p'),
        })

    def delete(self, request):
        user = request.user
        date_str = request.query_params.get('date')
        if not date_str:
            return Response({"error": "date parameter is required (YYYY-MM-DD)"}, status=400)
        try:
            target_date = datetime.strptime(date_str, '%Y-%m-%d').date()
        except ValueError:
            return Response({"error": "Invalid date format, use YYYY-MM-DD"}, status=400)

        # Delete date-wise data
        b_count = BrowsingLog.objects.filter(user=user, visited_at__date=target_date).delete()[0]
        sw_count = SwitchEvent.objects.filter(user=user, switched_at__date=target_date).delete()[0]
        s_count = SystemAppLog.objects.filter(user=user, started_at__date=target_date).delete()[0]
        ssw_count = SystemSwitchEvent.objects.filter(user=user, switched_at__date=target_date).delete()[0]
        fs_count = FocusSession.objects.filter(user=user, start_time__date=target_date).delete()[0]
        ai_count = AIInsight.objects.filter(user=user, date_analyzed=target_date).delete()[0]

        total_deleted = b_count + sw_count + s_count + ssw_count + fs_count + ai_count
        return Response({
            "message": f"Successfully deleted data for {target_date}",
            "deleted": {
                "browsing_logs": b_count,
                "browser_switches": sw_count,
                "system_logs": s_count,
                "system_switches": ssw_count,
                "focus_sessions": fs_count,
                "ai_insights": ai_count,
                "total": total_deleted
            }
        })
