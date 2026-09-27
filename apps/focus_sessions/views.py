from rest_framework import viewsets, generics, permissions, status
from rest_framework.response import Response
from django.utils import timezone
from django.core.cache import cache
from .models import FocusSession
from .serializers import FocusSessionSerializer


def break_cache_key(user_id):
    return f"break_active_{user_id}"


def get_active_break(user):
    """Return break dict if user is currently on a break, else None."""
    data = cache.get(break_cache_key(user.id))
    if not data:
        return None
    ends_at = float(data.get("ends_at", 0))
    now_ts = timezone.now().timestamp()
    if ends_at <= now_ts:
        cache.delete(break_cache_key(user.id))
        return None
    remaining = max(0, int(ends_at - now_ts))
    return {
        "on_break": True,
        "duration_mins": int(data.get("duration_mins", 0)),
        "ends_at": ends_at,
        "remaining_secs": remaining,
        "started_at": data.get("started_at"),
    }


def start_break_for_user(user, duration_mins):
    duration_mins = max(1, min(90, int(duration_mins)))
    now = timezone.now()
    ends_at = now.timestamp() + (duration_mins * 60)
    payload = {
        "duration_mins": duration_mins,
        "started_at": now.timestamp(),
        "ends_at": ends_at,
    }
    cache.set(break_cache_key(user.id), payload, timeout=(duration_mins * 60) + 60)
    return {
        "on_break": True,
        "duration_mins": duration_mins,
        "ends_at": ends_at,
        "remaining_secs": duration_mins * 60,
        "started_at": payload["started_at"],
    }


def clear_break_for_user(user):
    cache.delete(break_cache_key(user.id))


class FocusSessionViewSet(viewsets.ModelViewSet):
    permission_classes = [permissions.IsAuthenticated]
    serializer_class = FocusSessionSerializer

    def get_queryset(self):
        qs = FocusSession.objects.filter(user=self.request.user).order_by('-start_time')
        date_param = self.request.query_params.get('date')
        if date_param:
            qs = qs.filter(start_time__date=date_param)
        return qs

    def perform_create(self, serializer):
        # Block starting a focus session while on break
        if get_active_break(self.request.user):
            from rest_framework.exceptions import ValidationError
            raise ValidationError({"detail": "Cannot start a focus session while on break."})

        now = timezone.now()
        # Clean up any previously open active sessions for this user
        FocusSession.objects.filter(user=self.request.user, status='ACTIVE').update(
            status='COMPLETED',
            end_time=now
        )
        # Close any lingering unclosed system app logs so new session starts with a clean slate
        from apps.system_monitor.models import SystemAppLog
        SystemAppLog.objects.filter(user=self.request.user, ended_at__isnull=True).update(ended_at=now)

        # Ensure both desktop and vision background agents are running
        try:
            from apps.system_monitor.agent_launcher import ensure_agents_running
            ensure_agents_running()
        except Exception:
            pass

        serializer.save(user=self.request.user, start_time=now, status='ACTIVE')


class EndFocusSessionView(generics.GenericAPIView):
    permission_classes = [permissions.IsAuthenticated]
    serializer_class = FocusSessionSerializer

    def post(self, request, pk=None):
        return self._end(request, pk)

    def patch(self, request, pk=None):
        return self._end(request, pk)

    def _end(self, request, pk=None):
        if pk and pk != 0:
            session = FocusSession.objects.filter(pk=pk, user=request.user, status='ACTIVE').first()
        else:
            session = FocusSession.objects.filter(user=request.user, status='ACTIVE').order_by('-start_time').first()

        if not session:
            return Response({"error": "No active focus session found"}, status=status.HTTP_404_NOT_FOUND)

        now = timezone.now()
        # Clean up any other lingering active sessions
        FocusSession.objects.filter(user=request.user, status='ACTIVE').exclude(pk=session.pk).update(
            status='COMPLETED',
            end_time=now
        )
        session.end_time = now
        duration_mins = int((now - session.start_time).total_seconds() / 60)
        session.actual_duration_mins = max(1, duration_mins)
        session.status = request.data.get('status', 'COMPLETED')
        session.interruptions = request.data.get('interruptions', session.interruptions)
        session.notes = request.data.get('notes', session.notes)

        # Isolated metrics strictly between session start_time and end_time
        from apps.browsing.models import BrowsingLog, SwitchEvent
        from apps.system_monitor.models import SystemAppLog, SystemSwitchEvent, AttentionLog
        from django.db.models import Sum

        b_logs = BrowsingLog.objects.filter(user=request.user, visited_at__gte=session.start_time, visited_at__lte=now)
        b_prod = b_logs.filter(productivity_label='PRODUCTIVE').aggregate(s=Sum('time_spent_secs'))['s'] or 0
        b_dist = b_logs.filter(productivity_label='DISTRACTING').aggregate(s=Sum('time_spent_secs'))['s'] or 0

        s_logs = SystemAppLog.objects.filter(user=request.user, started_at__gte=session.start_time, started_at__lte=now)
        s_prod = s_logs.filter(productivity_label='PRODUCTIVE').aggregate(s=Sum('duration_secs'))['s'] or 0
        s_dist = s_logs.filter(productivity_label='DISTRACTING').aggregate(s=Sum('duration_secs'))['s'] or 0

        v_logs = AttentionLog.objects.filter(user=request.user, timestamp__gte=session.start_time, timestamp__lte=now)
        v_prod = v_logs.filter(state='FOCUSED').aggregate(s=Sum('duration_secs'))['s'] or 0
        v_dist = v_logs.filter(state__in=['LOOKING_AT_PHONE', 'LOOKING_AWAY']).aggregate(s=Sum('duration_secs'))['s'] or 0

        b_switches = SwitchEvent.objects.filter(user=request.user, switched_at__gte=session.start_time, switched_at__lte=now).count()
        s_switches = SystemSwitchEvent.objects.filter(user=request.user, switched_at__gte=session.start_time, switched_at__lte=now).count()

        session_total_secs = max(1, int((now - session.start_time).total_seconds()))
        distracted_secs = max(session.distracted_secs, b_dist + s_dist + v_dist)
        productive_secs = max(session.productive_secs, b_prod + s_prod + v_prod)

        # If desktop agent / extension didn't report explicit apps, default to session duration minus distractions
        if productive_secs == 0 and distracted_secs < session_total_secs:
            productive_secs = max(1, session_total_secs - distracted_secs)

        session.productive_secs = productive_secs
        session.distracted_secs = distracted_secs
        session.switches_count = max(session.switches_count, b_switches + s_switches)

        total_session_secs = session.productive_secs + session.distracted_secs
        if session.distracted_secs == 0:
            session.productivity_score = 100.0
        elif total_session_secs > 0:
            session.productivity_score = round((session.productive_secs / total_session_secs) * 100, 1)
        else:
            session.productivity_score = 100.0


        # Focus score heuristic (0 - 100) based on interruptions and switches
        switches_penalty = min(35, int(session.switches_count * 1.5))
        base_score = max(10, int(session.productivity_score) - switches_penalty)
        session.focus_score = base_score

        session.save()
        return Response(FocusSessionSerializer(session).data)


class ActiveFocusSessionView(generics.GenericAPIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        if request.headers.get('X-Client-Type') == 'chrome-extension' or request.META.get('HTTP_X_CLIENT_TYPE') == 'chrome-extension':
            cache.set(f"ext_active_{request.user.id}", timezone.now().timestamp(), 45)

        # Break pauses focus + shield for every client
        break_info = get_active_break(request.user)
        if break_info:
            return Response({
                "active": False,
                "on_break": True,
                "break": break_info,
                "session": None,
            })

        session = FocusSession.objects.filter(user=request.user, status='ACTIVE').order_by('-start_time').first()
        if not session:
            return Response({"active": False, "on_break": False, "session": None})

        now = timezone.now()
        duration_mins = int((now - session.start_time).total_seconds() / 60)
        return Response({
            "active": True,
            "on_break": False,
            "session": {
                "id": session.id,
                "session_type": session.session_type,
                "start_time": session.start_time.isoformat(),
                "duration_mins": duration_mins
            }
        })


class BreakStartView(generics.GenericAPIView):
    """POST /api/focus/break/start/ — start a timed break; pauses focus + shield."""
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        try:
            duration_mins = int(request.data.get("duration_mins", 5))
        except (TypeError, ValueError):
            return Response({"detail": "duration_mins must be an integer"}, status=status.HTTP_400_BAD_REQUEST)

        if duration_mins < 1 or duration_mins > 90:
            return Response({"detail": "duration_mins must be between 1 and 90"}, status=status.HTTP_400_BAD_REQUEST)

        break_info = start_break_for_user(request.user, duration_mins)
        return Response({
            "status": "break_started",
            **break_info,
        })


class BreakEndView(generics.GenericAPIView):
    """POST /api/focus/break/end/ — end break early."""
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        clear_break_for_user(request.user)
        return Response({"status": "break_ended", "on_break": False})


class BreakStatusView(generics.GenericAPIView):
    """GET /api/focus/break/status/"""
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        break_info = get_active_break(request.user)
        if not break_info:
            return Response({"on_break": False})
        return Response(break_info)


DEFAULT_BLOCKED_APPS = [
    'discord.exe',
    'slack.exe',
    'teams.exe',
    'zoom.exe',
    'spotify.exe',
    'steam.exe',
    'epicgameslauncher.exe',
    'telegram.exe',
    'whatsapp.exe',
    'imessage.exe',
    'fortniteclient-win64-shipping.exe',
    'robloxplayerbeta.exe',
    'primevideo.exe',
    'hulu.exe',
]

DEFAULT_BLOCKED_DOMAINS = [
    'youtube.com',
    'youtu.be',
    'reddit.com',
    'instagram.com',
    'tiktok.com',
    'facebook.com',
    'twitter.com',
    'x.com',
    'netflix.com',
    'twitch.tv',
    'pinterest.com',
    'snapchat.com',
    'primevideo.com',
    'hulu.com',
    'disneyplus.com',
    '9gag.com',
]


class BlocklistView(generics.GenericAPIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        from apps.users.models import UserProfile
        profile, _ = UserProfile.objects.get_or_create(user=request.user)
        prefs = profile.focus_preferences or {}
        blocked_apps = prefs.get('blocked_apps', DEFAULT_BLOCKED_APPS)
        blocked_domains = prefs.get('blocked_domains', DEFAULT_BLOCKED_DOMAINS)
        return Response({
            "blocked_apps": blocked_apps,
            "blocked_domains": blocked_domains
        })

    def post(self, request):
        from apps.users.models import UserProfile
        profile, _ = UserProfile.objects.get_or_create(user=request.user)
        prefs = profile.focus_preferences or {}

        if 'blocked_apps' in request.data:
            apps = [str(a).strip().lower() for a in request.data['blocked_apps'] if str(a).strip()]
            prefs['blocked_apps'] = list(dict.fromkeys(apps))

        if 'blocked_domains' in request.data:
            domains = [str(d).strip().lower() for d in request.data['blocked_domains'] if str(d).strip()]
            prefs['blocked_domains'] = list(dict.fromkeys(domains))

        profile.focus_preferences = prefs
        profile.save(update_fields=['focus_preferences'])
        return Response({
            "success": True,
            "blocked_apps": prefs.get('blocked_apps', DEFAULT_BLOCKED_APPS),
            "blocked_domains": prefs.get('blocked_domains', DEFAULT_BLOCKED_DOMAINS)
        })


