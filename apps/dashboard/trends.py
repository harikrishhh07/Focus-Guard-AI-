"""
Multi-Day Productivity Trends API View
Supports 7-day, 14-day, and 30-day analytics.
"""
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from django.utils import timezone
from django.db.models import Sum, Count
from datetime import timedelta

from apps.focus_sessions.models import FocusSession
from apps.system_monitor.models import SystemAppLog, SystemSwitchEvent
from apps.browsing.models import BrowsingLog, SwitchEvent


class TrendsView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        user = request.user
        try:
            days = int(request.query_params.get('days', 7))
        except (ValueError, TypeError):
            days = 7

        days = max(3, min(days, 90)) # Bound between 3 and 90 days
        today = timezone.localdate()
        start_date = today - timedelta(days=days - 1)

        daily_points = []
        total_prod_secs_all = 0
        total_dist_secs_all = 0
        total_tot_secs_all  = 0
        total_switches_all = 0
        total_sessions_all = 0

        # Pre-fetch relevant logs for the user across the window
        all_sys_logs = SystemAppLog.objects.filter(
            user=user, started_at__date__gte=start_date, started_at__date__lte=today
        )
        all_browse_logs = BrowsingLog.objects.filter(
            user=user, visited_at__date__gte=start_date, visited_at__date__lte=today
        )
        all_sys_switches = SystemSwitchEvent.objects.filter(
            user=user, switched_at__date__gte=start_date, switched_at__date__lte=today
        )
        all_browse_switches = SwitchEvent.objects.filter(
            user=user, switched_at__date__gte=start_date, switched_at__date__lte=today
        )
        all_sessions = FocusSession.objects.filter(
            user=user, start_time__date__gte=start_date, start_time__date__lte=today
        )

        for i in range(days):
            d = start_date + timedelta(days=i)
            d_str = d.isoformat()
            day_label = d.strftime('%a') if days <= 7 else d.strftime('%b %d')

            # Aggregate logs for day d
            s_logs = all_sys_logs.filter(started_at__date=d)
            b_logs = all_browse_logs.filter(visited_at__date=d)
            d_sessions = all_sessions.filter(start_time__date=d)

            # Durations — by productivity tier
            s_prod = s_logs.filter(productivity_label='PRODUCTIVE').aggregate(s=Sum('duration_secs'))['s'] or 0
            s_dist = s_logs.filter(productivity_label='DISTRACTING').aggregate(s=Sum('duration_secs'))['s'] or 0
            b_prod = b_logs.filter(productivity_label='PRODUCTIVE').aggregate(s=Sum('time_spent_secs'))['s'] or 0
            b_dist = b_logs.filter(productivity_label='DISTRACTING').aggregate(s=Sum('time_spent_secs'))['s'] or 0

            # Full total (incl. NEUTRAL) as the real denominator
            s_total = s_logs.aggregate(s=Sum('duration_secs'))['s'] or 0
            b_total = b_logs.aggregate(s=Sum('time_spent_secs'))['s'] or 0
            day_full_tot = s_total + b_total  # includes neutral time

            day_prod_secs = s_prod + b_prod
            day_dist_secs = s_dist + b_dist
            # day_tot_secs for display only (prod + dist hours)
            day_tot_secs  = day_prod_secs + day_dist_secs

            # Switches
            d_switches = (
                all_sys_switches.filter(switched_at__date=d).count() +
                all_browse_switches.filter(switched_at__date=d).count()
            )
            sess_sw = d_sessions.aggregate(s=Sum('switches_count'))['s'] or 0
            final_switches = max(d_switches, sess_sw)

            # Daily Score: use full denominator (incl. neutral), then penalize switches
            if day_full_tot > 0:
                raw_prod_pct = round((day_prod_secs / day_full_tot) * 100, 1)
            elif day_prod_secs > 0:
                raw_prod_pct = 100.0
            else:
                raw_prod_pct = None  # no data for this day

            if raw_prod_pct is not None:
                switch_penalty = min(30, round(final_switches * 1.5, 1))
                day_score = round(max(0.0, raw_prod_pct - switch_penalty), 1)
            else:
                day_score = None

            total_prod_secs_all  += day_prod_secs
            total_dist_secs_all  += day_dist_secs
            total_tot_secs_all   += day_full_tot
            total_switches_all   += final_switches
            total_sessions_all   += d_sessions.count()

            daily_points.append({
                'date': d_str,
                'label': day_label,
                'day_name': d.strftime('%A'),
                'productive_hours': round(day_prod_secs / 3600, 2),
                'distracted_hours': round(day_dist_secs / 3600, 2),
                'productive_secs': day_prod_secs,
                'distracted_secs': day_dist_secs,
                'total_secs': day_full_tot,
                'total_hours': round(day_full_tot / 3600, 2),
                'productivity_score': day_score,
                'raw_productive_pct': raw_prod_pct,
                'switches': final_switches,
                'switches_count': final_switches,
                'sessions_count': d_sessions.count(),
            })

        # Calculate overall averages
        if total_tot_secs_all > 0:
            avg_raw_pct = round((total_prod_secs_all / total_tot_secs_all) * 100, 1)
            avg_sw_penalty = min(30, round((total_switches_all / max(1, days)) * 1.5, 1))
            avg_score = round(max(0.0, avg_raw_pct - avg_sw_penalty), 1)
        elif total_prod_secs_all > 0:
            avg_raw_pct = 100.0
            avg_score = 100.0
        else:
            avg_raw_pct = None
            avg_score = None

        # Prior period comparison for delta %
        prior_start = start_date - timedelta(days=days)
        prior_end = start_date - timedelta(days=1)

        prior_sys = SystemAppLog.objects.filter(
            user=user, started_at__date__gte=prior_start, started_at__date__lte=prior_end
        )
        prior_browse = BrowsingLog.objects.filter(
            user=user, visited_at__date__gte=prior_start, visited_at__date__lte=prior_end
        )
        prior_prod = (prior_sys.filter(productivity_label='PRODUCTIVE').aggregate(s=Sum('duration_secs'))['s'] or 0) + \
                     (prior_browse.filter(productivity_label='PRODUCTIVE').aggregate(s=Sum('time_spent_secs'))['s'] or 0)
        prior_tot  = (prior_sys.aggregate(s=Sum('duration_secs'))['s'] or 0) + \
                     (prior_browse.aggregate(s=Sum('time_spent_secs'))['s'] or 0)

        if prior_tot > 0:
            prior_score = round((prior_prod / prior_tot) * 100, 1)
        elif prior_prod > 0:
            prior_score = 100.0
        else:
            prior_score = avg_score  # no comparison data — show equal

        delta_score = round((avg_score or 0) - (prior_score or 0), 1)

        return Response({
            'days': days,
            'start_date': start_date.isoformat(),
            'end_date': today.isoformat(),
            'average_score': avg_score,
            'avg_productivity_score': avg_score,
            'avg_raw_productive_pct': avg_raw_pct,
            'delta_vs_prior': delta_score,
            'total_productive_secs': total_prod_secs_all,
            'total_distracted_secs': total_dist_secs_all,
            'total_productive_hours': round(total_prod_secs_all / 3600, 2),
            'total_distracted_hours': round(total_dist_secs_all / 3600, 2),
            'total_switches': total_switches_all,
            'total_sessions': total_sessions_all,
            'daily_points': daily_points,
        })

