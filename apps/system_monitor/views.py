from datetime import timedelta
from rest_framework import generics, permissions, status
from rest_framework.response import Response
from django.utils import timezone
from django.db.models import Sum, Count
from .models import SystemAppLog, SystemSwitchEvent, AttentionLog
from .serializers import (
    SystemAppLogSerializer, SystemSwitchEventSerializer, AttentionLogSerializer
)
from apps.focus_sessions.models import FocusSession



class SystemAppLogCreateView(generics.CreateAPIView):
    """POST /api/system/log/ — desktop agent posts a session record."""
    permission_classes = [permissions.IsAuthenticated]
    serializer_class = SystemAppLogSerializer

    def create(self, request, *args, **kwargs):
        from django.core.cache import cache
        from apps.focus_sessions.views import get_active_break

        # When Chrome extension is disconnected, reject desktop telemetry
        if not cache.get(f"ext_active_{request.user.id}"):
            return Response({
                "status": "paused",
                "detail": "Desktop tracking paused — Chrome extension is disconnected.",
            }, status=status.HTTP_200_OK)

        if get_active_break(request.user):
            return Response({
                "status": "paused",
                "detail": "Desktop tracking paused — user is on break.",
            }, status=status.HTTP_200_OK)

        # Desktop telemetry is independent from focus sessions so the dashboard
        # can show the current app and switch history at all times.
        active_session = FocusSession.objects.filter(user=request.user, status='ACTIVE').first()

        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        user = request.user
        process_name = data.get('process_name')
        ended_at = data.get('ended_at')
        duration_secs = data.get('duration_secs', 0)
        today = timezone.localdate()
        now = timezone.now()

        # Close stale open logs from previous days so new activity is attributed
        # to "today" instead of endlessly extending yesterday's row.
        stale_opens = SystemAppLog.objects.filter(
            user=user,
            process_name__iexact=process_name,
            ended_at__isnull=True,
            started_at__date__lt=today,
        )
        for stale in stale_opens:
            stale.ended_at = now
            elapsed = max(1, int((now - stale.started_at).total_seconds()))
            stale.duration_secs = max(stale.duration_secs or 0, elapsed)
            stale.save(update_fields=['ended_at', 'duration_secs'])

        # Only reuse an open log that started today
        open_log = SystemAppLog.objects.filter(
            user=user,
            process_name__iexact=process_name,
            ended_at__isnull=True,
            started_at__date=today,
        ).order_by('-started_at').first()

        if open_log:
            # If opened before active session started, clamp start time to session start
            if active_session and open_log.started_at < active_session.start_time:
                open_log.started_at = active_session.start_time
            open_log.duration_secs = max(open_log.duration_secs, duration_secs)
            if data.get('window_title'):
                open_log.window_title = data['window_title']
            if data.get('productivity_label'):
                open_log.productivity_label = data['productivity_label']
            if data.get('category'):
                open_log.category = data['category']
            if data.get('app_name'):
                open_log.app_name = data['app_name']
            if ended_at:
                open_log.ended_at = ended_at
            open_log.save()
            return Response(SystemAppLogSerializer(open_log).data, status=status.HTTP_200_OK)

        instance = serializer.save(user=user)
        return Response(SystemAppLogSerializer(instance).data, status=status.HTTP_201_CREATED)


class SystemSwitchCreateView(generics.CreateAPIView):
    """POST /api/system/switch/ — desktop agent posts a switch event."""
    permission_classes = [permissions.IsAuthenticated]
    serializer_class = SystemSwitchEventSerializer

    def create(self, request, *args, **kwargs):
        from django.core.cache import cache
        from apps.focus_sessions.views import get_active_break
        if not cache.get(f"ext_active_{request.user.id}"):
            return Response({
                "status": "paused",
                "detail": "Desktop tracking paused — Chrome extension is disconnected.",
            }, status=status.HTTP_200_OK)
        if get_active_break(request.user):
            return Response({
                "status": "paused",
                "detail": "Desktop tracking paused — user is on break.",
            }, status=status.HTTP_200_OK)
        return super().create(request, *args, **kwargs)

    def perform_create(self, serializer):
        serializer.save(user=self.request.user)


class SystemTodaySummaryView(generics.GenericAPIView):
    """GET /api/system/today/ — today's system activity summary."""
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        today = timezone.localdate()
        user = request.user
        # Auto-close stale open sessions so live "active app" stays accurate
        now = timezone.now()
        for stale in SystemAppLog.objects.filter(user=user, ended_at__isnull=True, started_at__date__lt=today):
            stale.ended_at = now
            elapsed = max(1, int((now - stale.started_at).total_seconds()))
            stale.duration_secs = max(stale.duration_secs or 0, elapsed)
            stale.save(update_fields=['ended_at', 'duration_secs'])

        logs = SystemAppLog.objects.filter(user=user, started_at__date=today)
        if not logs.exists():
            # Fallback: last 7 days for this user only
            from datetime import timedelta
            cutoff = timezone.now() - timedelta(days=7)
            logs = SystemAppLog.objects.filter(user=user, started_at__gte=cutoff)

        total_secs = logs.aggregate(s=Sum('duration_secs'))['s'] or 0
        prod_secs  = logs.filter(productivity_label='PRODUCTIVE').aggregate(s=Sum('duration_secs'))['s'] or 0
        dist_secs  = logs.filter(productivity_label='DISTRACTING').aggregate(s=Sum('duration_secs'))['s'] or 0

        # Per-app aggregation (group by app_name)
        top_apps = list(
            logs.values('app_name', 'process_name', 'category', 'productivity_label')
            .annotate(total_secs=Sum('duration_secs'))
            .order_by('-total_secs')[:15]
        )

        # Category breakdown
        categories = {}
        for row in logs.values('category').annotate(s=Sum('duration_secs')):
            categories[row['category']] = round((row['s'] or 0) / 60, 1)

        # System switches (today first, then recent history for this user)
        switches = SystemSwitchEvent.objects.filter(user=user, switched_at__date=today)
        if not switches.exists():
            from datetime import timedelta
            cutoff = timezone.now() - timedelta(days=7)
            switches = SystemSwitchEvent.objects.filter(user=user, switched_at__gte=cutoff)
        total_switches = switches.count()

        top_transitions = list(
            switches.values('from_app', 'to_app', 'from_category', 'to_category')
            .annotate(count=Count('id'))
            .order_by('-count')[:8]
        )

        recent_switches = list(
            switches.values('from_app', 'from_category', 'to_app', 'to_category', 'switched_at')
            .order_by('-switched_at')[:20]
        )
        for r in recent_switches:
            if r.get('switched_at'):
                r['switched_at'] = r['switched_at'].isoformat()

        # Currently active app (most recent log)
        active = logs.filter(ended_at__isnull=True).order_by('-started_at').first() or logs.order_by('-started_at', '-id').first()
        active_app = None
        if active:
            active_app = {
                'app_name': active.app_name,
                'process_name': active.process_name,
                'window_title': active.window_title,
                'category': active.category,
                'productivity_label': active.productivity_label,
                'started_at': active.started_at.isoformat(),
            }

        return Response({
            'date': str(today),
            'total_secs': total_secs,
            'productive_secs': prod_secs,
            'distracted_secs': dist_secs,
            'productive_pct': round(prod_secs / total_secs * 100, 1) if total_secs else 0,
            'distracting_pct': round(dist_secs / total_secs * 100, 1) if total_secs else 0,
            'top_apps': top_apps,
            'category_breakdown': categories,
            'total_switches': total_switches,
            'top_transitions': top_transitions,
            'recent_switches': recent_switches,
            'active_app': active_app,
        })


class SystemLiveView(generics.GenericAPIView):
    """GET /api/system/live/ — currently active app on this machine."""
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        active = SystemAppLog.objects.filter(
            user=request.user,
            ended_at__isnull=True
        ).order_by('-started_at').first() or SystemAppLog.objects.order_by('-started_at', '-id').first()

        if active:
            return Response({
                'app_name': active.app_name,
                'process_name': active.process_name,
                'window_title': active.window_title,
                'category': active.category,
                'productivity_label': active.productivity_label,
                'started_at': active.started_at.isoformat(),
            })
        return Response({'app_name': None})


class AttentionLogCreateView(generics.CreateAPIView):
    """POST /api/system/attention/ — vision agent posts real-time face attention state."""
    permission_classes = [permissions.IsAuthenticated]
    serializer_class = AttentionLogSerializer

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        user = request.user
        state = data.get('state', 'FOCUSED')
        duration = data.get('duration_secs', 3)

        # Check for active focus session
        active_session = FocusSession.objects.filter(user=user, status='ACTIVE').first()

        if active_session:
            # Sync distraction/productivity with active session
            if state in ['LOOKING_AT_PHONE', 'LOOKING_AWAY']:
                active_session.distracted_secs += duration
                if duration >= 5 or state == 'LOOKING_AT_PHONE':
                    active_session.interruptions += 1
            elif state == 'FOCUSED':
                active_session.productive_secs += duration

            total_tracked = active_session.productive_secs + active_session.distracted_secs
            if total_tracked > 0:
                active_session.productivity_score = round(
                    (active_session.productive_secs / total_tracked) * 100.0, 1
                )
                active_session.focus_score = active_session.productivity_score
            active_session.save()

        instance = serializer.save(user=user, session=active_session)
        return Response({
            'status': 'success',
            'state': instance.state,
            'attention_score': instance.attention_score,
            'active_session_id': active_session.id if active_session else None,
            'session_distracted_secs': active_session.distracted_secs if active_session else 0,
            'session_productive_secs': active_session.productive_secs if active_session else 0,
        }, status=status.HTTP_201_CREATED)


class AttentionLiveView(generics.GenericAPIView):
    """GET /api/system/attention/live/ — get live attention status for dashboard."""
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        now = timezone.now()
        recent_threshold = now - timedelta(seconds=20)
        user = request.user
        today = timezone.localdate()

        from apps.focus_sessions.models import FocusSession
        active_focus = FocusSession.objects.filter(
            user=user,
            status='ACTIVE',
            start_time__date=today
        ).order_by('-start_time').first()

        if not active_focus:
            return Response({
                'is_active': False,
                'state': 'STANDBY',
                'attention_score': None,
                'face_detected': False,
                'emotion': '',
                'phone_distraction_count': 0,
                'phone_distraction_secs': 0,
                'away_secs': 0,
                'focus_ratio': None,
                'timestamp': None,
            })

        # When session is active: isolate stats strictly to current session
        session_logs = AttentionLog.objects.filter(
            user=user,
            timestamp__gte=active_focus.start_time
        )

        phone_logs = session_logs.filter(state='LOOKING_AT_PHONE')
        phone_count = phone_logs.count()
        phone_secs = phone_logs.aggregate(s=Sum('duration_secs'))['s'] or 0

        away_logs = session_logs.filter(state='LOOKING_AWAY')
        away_secs = away_logs.aggregate(s=Sum('duration_secs'))['s'] or 0

        focused_logs = session_logs.filter(state='FOCUSED')
        focused_secs = focused_logs.aggregate(s=Sum('duration_secs'))['s'] or 0

        total_vision_secs = phone_secs + away_secs + focused_secs
        focus_ratio = round(focused_secs / total_vision_secs * 100, 1) if total_vision_secs > 0 else 100.0

        latest_log = session_logs.filter(timestamp__gte=recent_threshold).order_by('-timestamp').first()

        if latest_log:
            return Response({
                'is_active': True,
                'state': latest_log.state,
                'attention_score': latest_log.attention_score,
                'pitch': latest_log.pitch,
                'yaw': latest_log.yaw,
                'face_detected': latest_log.face_detected,
                'emotion': latest_log.emotion,
                'phone_distraction_count': phone_count,
                'phone_distraction_secs': phone_secs,
                'away_secs': away_secs,
                'focus_ratio': focus_ratio,
                'timestamp': latest_log.timestamp.isoformat(),
            })

        return Response({
            'is_active': True,
            'state': 'FOCUSED',
            'attention_score': 100.0,
            'face_detected': True,
            'emotion': '',
            'phone_distraction_count': phone_count,
            'phone_distraction_secs': phone_secs,
            'away_secs': away_secs,
            'focus_ratio': focus_ratio,
            'timestamp': None,
        })

