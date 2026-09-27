"""
FocusGuard AI — Gamification, Streaks, Heatmap & Badges Engine
==============================================================
Calculates:
  1. Daily Streaks (Current streak, Longest streak, Total active days)
  2. LeetCode / GitHub style 90-day Activity Heatmap matrix
  3. Achievement Badges with live evaluation and progress tracking
"""

from datetime import date, timedelta, datetime
from django.utils import timezone
from django.db.models import Sum
from rest_framework import generics, permissions
from rest_framework.response import Response

from apps.focus_sessions.models import FocusSession
from apps.system_monitor.models import SystemAppLog, AttentionLog
from apps.browsing.models import BrowsingLog


def compute_user_streaks(user):
    """
    Computes:
      - current_streak: consecutive active days ending either today or yesterday
      - longest_streak: maximum historical streak
      - total_active_days: count of unique days with activity
      - today_active: whether user has recorded activity today
    """
    today = timezone.localdate()

    # Active dates from FocusSession
    session_dates = set(
        FocusSession.objects.filter(user=user)
        .values_list('start_time__date', flat=True)
    )
    # Active dates with productive system or browsing or camera focus time
    sys_dates = set(
        SystemAppLog.objects.filter(user=user, productivity_label='PRODUCTIVE')
        .values_list('started_at__date', flat=True)
    )
    browse_dates = set(
        BrowsingLog.objects.filter(user=user, productivity_label='PRODUCTIVE')
        .values_list('visited_at__date', flat=True)
    )
    attn_dates = set(
        AttentionLog.objects.filter(user=user, state='FOCUSED')
        .values_list('timestamp__date', flat=True)
    )

    all_active_dates = sorted(session_dates | sys_dates | browse_dates | attn_dates)
    total_active_days = len(all_active_dates)
    today_active = today in all_active_dates


    if not all_active_dates:
        return {
            "current_streak": 0,
            "longest_streak": 0,
            "total_active_days": 0,
            "today_active": False,
            "is_active_today": False,
            "streak_frozen": False,
        }

    # Calculate current streak backwards from today or yesterday
    current_streak = 0
    check_date = today if today_active else (today - timedelta(days=1))
    active_set = set(all_active_dates)

    while check_date in active_set:
        current_streak += 1
        check_date -= timedelta(days=1)

    # Calculate longest streak across all history
    longest_streak = 0
    temp_streak = 0
    prev_date = None

    for d in all_active_dates:
        if prev_date is None:
            temp_streak = 1
        elif d == prev_date + timedelta(days=1):
            temp_streak += 1
        else:
            temp_streak = 1
        prev_date = d
        if temp_streak > longest_streak:
            longest_streak = temp_streak

    return {
        "current_streak": current_streak,
        "longest_streak": max(longest_streak, current_streak),
        "total_active_days": total_active_days,
        "today_active": today_active,
        "is_active_today": today_active,
        "streak_frozen": (current_streak > 0 and not today_active),
    }


def compute_activity_heatmap(user, days=98):
    """
    Generates 14 full weeks (98 days) of daily intensity data for the contribution calendar.
    Aligns nicely from Sunday to Saturday or Monday to Sunday.
    """
    today = timezone.localdate()
    # End on the upcoming Saturday to complete the grid week
    days_to_saturday = (5 - today.weekday()) % 7
    end_date = today + timedelta(days=days_to_saturday)
    start_date = end_date - timedelta(days=days - 1)

    # Daily productive seconds from Focus Sessions
    sessions = (
        FocusSession.objects.filter(user=user, start_time__date__gte=start_date, start_time__date__lte=end_date)
        .values('start_time__date')
        .annotate(
            total_prod=Sum('productive_secs'),
            total_dist=Sum('distracted_secs')
        )
    )
    session_map = {item['start_time__date']: item for item in sessions}

    # Daily productive seconds from SystemAppLog
    sys_logs = (
        SystemAppLog.objects.filter(user=user, started_at__date__gte=start_date, started_at__date__lte=end_date, productivity_label='PRODUCTIVE')
        .values('started_at__date')
        .annotate(total_dur=Sum('duration_secs'))
    )
    sys_map = {item['started_at__date']: item['total_dur'] or 0 for item in sys_logs}

    # Daily productive seconds from BrowsingLog
    browse_logs = (
        BrowsingLog.objects.filter(user=user, visited_at__date__gte=start_date, visited_at__date__lte=end_date, productivity_label='PRODUCTIVE')
        .values('visited_at__date')
        .annotate(total_dur=Sum('time_spent_secs'))
    )
    browse_map = {item['visited_at__date']: item['total_dur'] or 0 for item in browse_logs}

    # Daily focused seconds from AttentionLog (Camera Tracking)
    attn_logs = (
        AttentionLog.objects.filter(user=user, timestamp__date__gte=start_date, timestamp__date__lte=end_date, state='FOCUSED')
        .values('timestamp__date')
        .annotate(total_dur=Sum('duration_secs'))
    )
    attn_map = {item['timestamp__date']: item['total_dur'] or 0 for item in attn_logs}

    # Session counts per day
    session_counts = (
        FocusSession.objects.filter(user=user, start_time__date__gte=start_date, start_time__date__lte=end_date)
        .values('start_time__date')
    )
    count_map = {}
    for item in session_counts:
        d = item['start_time__date']
        count_map[d] = count_map.get(d, 0) + 1

    cells = []
    curr = start_date
    while curr <= end_date:
        s_data = session_map.get(curr, {})
        sess_prod = s_data.get('total_prod') or 0
        sys_prod = sys_map.get(curr) or 0
        browse_prod = browse_map.get(curr) or 0
        attn_prod = attn_map.get(curr) or 0
        s_count = count_map.get(curr, 0)

        # Total productive seconds across all tracked modalities
        total_prod_secs = max(sess_prod, sys_prod, browse_prod, attn_prod, sess_prod + browse_prod)
        prod_mins = max(1 if (total_prod_secs > 0 or s_count > 0) else 0, round(total_prod_secs / 60))

        # Intensity Level:
        # 0: Empty (no focus sessions, zero seconds)
        # 1: 1 - 20 mins (or any focus session activity)
        # 2: 20 - 45 mins
        # 3: 45 - 90 mins
        # 4: >= 90 mins
        if total_prod_secs == 0 and s_count == 0:
            level = 0
        elif prod_mins < 20:
            level = 1
        elif prod_mins < 45:
            level = 2
        elif prod_mins < 90:
            level = 3
        else:
            level = 4

        cells.append({
            "date": curr.isoformat(),
            "day_of_week": curr.strftime('%a'),
            "weekday": curr.weekday(), # 0=Mon, 6=Sun
            "is_future": curr > today,
            "productive_mins": prod_mins,
            "sessions_count": s_count,
            "level": level,
        })
        curr += timedelta(days=1)

    return cells



def evaluate_badges(user, streak_info):
    """
    Evaluates milestone achievement badges with progress percentages and unlocked statuses.
    """
    completed_sessions = FocusSession.objects.filter(user=user, status='COMPLETED')
    total_sessions_count = completed_sessions.count()
    total_productive_secs = completed_sessions.aggregate(s=Sum('productive_secs'))['s'] or 0
    total_productive_mins = round(total_productive_secs / 60)

    # Max single session continuous duration
    max_duration_mins = 0
    zero_distraction_count = 0
    morning_sessions = 0
    night_sessions = 0
    high_score_sessions = 0

    for s in completed_sessions:
        dur = s.actual_duration_mins or (s.productive_secs // 60)
        if dur > max_duration_mins:
            max_duration_mins = dur
        if (s.distracted_secs == 0 or (s.productivity_score and s.productivity_score >= 99.0)) and dur >= 20:
            zero_distraction_count += 1
        if s.productivity_score and s.productivity_score >= 80.0:
            high_score_sessions += 1

        local_start = timezone.localtime(s.start_time)
        if local_start.hour < 8:
            morning_sessions += 1
        elif local_start.hour >= 22:
            night_sessions += 1

    current_streak = streak_info['current_streak']
    longest_streak = streak_info['longest_streak']
    best_streak = max(current_streak, longest_streak)

    # Badge Definitions — distinctive names for the showcase
    badges = [
        {
            "id": "first_sprint",
            "title": "Signal Lit",
            "tier": "BRONZE",
            "tier_color": "#cd7f32",
            "icon": "✦",
            "description": "Light your first deep-focus signal — one completed sprint.",
            "unlocked": total_sessions_count >= 1,
            "progress": min(100, int((total_sessions_count / 1) * 100)),
            "progress_label": f"{min(total_sessions_count, 1)} / 1 Session",
        },
        {
            "id": "streak_3",
            "title": "Pulse Chain",
            "tier": "BRONZE",
            "tier_color": "#cd7f32",
            "icon": "◎",
            "description": "Keep the pulse alive across 3 consecutive focus days.",
            "unlocked": best_streak >= 3,
            "progress": min(100, int((best_streak / 3) * 100)),
            "progress_label": f"{min(best_streak, 3)} / 3 Days",
        },
        {
            "id": "streak_7",
            "title": "Orbit Keeper",
            "tier": "SILVER",
            "tier_color": "#94a3b8",
            "icon": "◌",
            "description": "Hold a full week in orbit — 7-day unbroken streak.",
            "unlocked": best_streak >= 7,
            "progress": min(100, int((best_streak / 7) * 100)),
            "progress_label": f"{min(best_streak, 7)} / 7 Days",
        },
        {
            "id": "streak_30",
            "title": "Horizon Anchor",
            "tier": "GOLD",
            "tier_color": "#f59e0b",
            "icon": "◈",
            "description": "Anchor a month of momentum — 30-day focus streak.",
            "unlocked": best_streak >= 30,
            "progress": min(100, int((best_streak / 30) * 100)),
            "progress_label": f"{min(best_streak, 30)} / 30 Days",
        },
        {
            "id": "zero_drift",
            "title": "Still Mind",
            "tier": "SILVER",
            "tier_color": "#94a3b8",
            "icon": "⬡",
            "description": "A session with near-zero drift — ≥20m, no distractions.",
            "unlocked": zero_distraction_count >= 1,
            "progress": min(100, int((zero_distraction_count / 1) * 100)),
            "progress_label": f"{min(zero_distraction_count, 1)} / 1 Session",
        },
        {
            "id": "deep_diver",
            "title": "Flow Depth",
            "tier": "GOLD",
            "tier_color": "#f59e0b",
            "icon": "▽",
            "description": "Descend into deep flow — one block of 90+ minutes.",
            "unlocked": max_duration_mins >= 90,
            "progress": min(100, int((max_duration_mins / 90) * 100)),
            "progress_label": f"{min(max_duration_mins, 90)}m / 90m",
        },
        {
            "id": "early_bird",
            "title": "Dawn Runner",
            "tier": "BRONZE",
            "tier_color": "#cd7f32",
            "icon": "△",
            "description": "Start before sunrise crowds — a session before 8:00 AM.",
            "unlocked": morning_sessions >= 1,
            "progress": min(100, int((morning_sessions / 1) * 100)),
            "progress_label": f"{min(morning_sessions, 1)} / 1 Session",
        },
        {
            "id": "night_owl",
            "title": "Midnight Current",
            "tier": "BRONZE",
            "tier_color": "#cd7f32",
            "icon": "☾",
            "description": "Ride the late current — finish a block after 10:00 PM.",
            "unlocked": night_sessions >= 1,
            "progress": min(100, int((night_sessions / 1) * 100)),
            "progress_label": f"{min(night_sessions, 1)} / 1 Session",
        },
        {
            "id": "century_club",
            "title": "Hundred Fold",
            "tier": "SILVER",
            "tier_color": "#94a3b8",
            "icon": "◆",
            "description": "Stack 100 productive minutes across your journey.",
            "unlocked": total_productive_mins >= 100,
            "progress": min(100, int((total_productive_mins / 100) * 100)),
            "progress_label": f"{min(total_productive_mins, 100)} / 100 Mins",
        },
        {
            "id": "grandmaster",
            "title": "Apex Sentinel",
            "tier": "DIAMOND",
            "tier_color": "#38bdf8",
            "icon": "♛",
            "description": "Guard the apex — 10 sessions scoring 80% or higher.",
            "unlocked": high_score_sessions >= 10,
            "progress": min(100, int((high_score_sessions / 10) * 100)),
            "progress_label": f"{min(high_score_sessions, 10)} / 10 Sessions",
        },
    ]

    for b in badges:
        b["name"] = b.get("title", "")
        b["progress_pct"] = b.get("progress", 0)

    return badges


class GamificationView(generics.GenericAPIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        user = request.user
        streaks = compute_user_streaks(user)
        heatmap = compute_activity_heatmap(user, days=98)
        badges = evaluate_badges(user, streaks)

        unlocked_count = sum(1 for b in badges if b['unlocked'])

        return Response({
            "streaks": streaks,
            "heatmap": heatmap,
            "badges": badges,
            "badges_summary": {
                "total": len(badges),
                "unlocked": unlocked_count,
                "percentage": round((unlocked_count / len(badges)) * 100)
            }
        })
