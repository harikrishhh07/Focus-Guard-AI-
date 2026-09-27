from rest_framework import viewsets, generics, permissions, status
from rest_framework.response import Response
from django.utils import timezone
from django.db.models import Sum, Count
from .models import BrowsingLog, BrowsingSession, SwitchEvent
from .serializers import BrowsingLogSerializer, BrowsingSessionSerializer, SwitchEventSerializer
from apps.focus_sessions.models import FocusSession


class BrowsingLogViewSet(viewsets.ModelViewSet):
    permission_classes = [permissions.IsAuthenticated]
    serializer_class = BrowsingLogSerializer

    def get_queryset(self):
        user = self.request.user
        today = timezone.localdate()
        # Prefer today's activity for the signed-in user (dashboard Activity tab)
        qs = BrowsingLog.objects.filter(user=user, visited_at__date=today).order_by('-visited_at')
        if qs.exists():
            return qs
        # Fall back to recent history for this user (last 7 days)
        from datetime import timedelta
        cutoff = timezone.now() - timedelta(days=7)
        qs = BrowsingLog.objects.filter(user=user, visited_at__gte=cutoff).order_by('-visited_at')
        if qs.exists():
            return qs
        return BrowsingLog.objects.filter(user=user).order_by('-visited_at')

    def create(self, request, *args, **kwargs):
        from django.core.cache import cache
        cache.set(f"ext_active_{request.user.id}", timezone.now().timestamp(), 45)
        return super().create(request, *args, **kwargs)

    def perform_create(self, serializer):
        domain = serializer.validated_data.get('domain', '').lower()
        title = serializer.validated_data.get('page_title', '')
        category = serializer.validated_data.get('category', '')
        prod_label = serializer.validated_data.get('productivity_label', '')

        # Server-side classification refinement for YouTube & Entertainment
        if 'youtube.com' in domain or category == 'ENTERTAINMENT':
            import re
            clean_title = re.sub(r'^\(\d+\)\s*', '', title or '').lower().replace(' - youtube', '').strip()
            EDUCATIONAL_SUBSTRINGS = [
                'tutorial', 'course', 'lecture', 'learn', 'crash course', 'how to build',
                'how to code', 'how to create', 'how to install', 'how to use', 'how to',
                'guide', 'masterclass', 'python', 'javascript', 'typescript', 'react',
                'django', 'fastapi', 'flask', 'algorithms', 'data structures',
                'freecodecamp', 'cs50', 'khan academy', 'mit opencourseware',
                'stanford', 'calculus', 'linear algebra', 'physics', 'documentation',
                'coding', 'programming', 'developer', 'devops', 'docker', 'sql',
                'machine learning', 'deep learning', 'artificial intelligence'
            ]
            ENTERTAINMENT_SUBSTRINGS = [
                'song', 'music', 'audio', 'track', 'album', 'remix', 'lyrics', 'official video',
                'official audio', 'lofi', 'slowed', 'reverb', 'trailer', 'teaser', 'gameplay',
                "let's play", 'reaction', 'prank', 'vlog', 'comedy', 'standup', 'movie', 'film',
                'scene', 'clip', 'drama', 'anime', 'podcast'
            ]
            has_edu = any(edu in clean_title for edu in EDUCATIONAL_SUBSTRINGS)
            has_ent = any(ent in clean_title for ent in ENTERTAINMENT_SUBSTRINGS)

            if has_edu and not has_ent:
                is_dev = any(k in clean_title for k in ['code', 'python', 'javascript', 'react', 'programming', 'sql', 'django', 'fastapi', 'docker'])
                category = 'DEVELOPMENT' if is_dev else 'EDUCATION'
                prod_label = 'PRODUCTIVE'
            else:
                category = 'ENTERTAINMENT'
                prod_label = 'DISTRACTING'

            serializer.save(user=self.request.user, category=category, productivity_label=prod_label)
        else:
            serializer.save(user=self.request.user)


class TodayBrowsingSummaryView(generics.GenericAPIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        today = timezone.localdate()
        user = request.user
        logs = BrowsingLog.objects.filter(user=user, visited_at__date=today)
        scope = 'today'
        if not logs.exists():
            from datetime import timedelta
            cutoff = timezone.now() - timedelta(days=7)
            logs = BrowsingLog.objects.filter(user=user, visited_at__gte=cutoff)
            scope = 'last_7_days'

        total_secs = logs.aggregate(s=Sum('time_spent_secs'))['s'] or 0
        prod_secs = logs.filter(productivity_label='PRODUCTIVE').aggregate(s=Sum('time_spent_secs'))['s'] or 0
        dist_secs = logs.filter(productivity_label='DISTRACTING').aggregate(s=Sum('time_spent_secs'))['s'] or 0
        neut_secs = logs.filter(productivity_label='NEUTRAL').aggregate(s=Sum('time_spent_secs'))['s'] or 0

        # Top sites (aggregated by domain)
        top_sites = list(
            logs.values('domain', 'category', 'productivity_label')
            .annotate(total_secs=Sum('time_spent_secs'))
            .order_by('-total_secs')[:20]
        )

        return Response({
            "date": str(today),
            "scope": scope,
            "total_time_secs": total_secs,
            "productive_time_secs": prod_secs,
            "distracted_time_secs": dist_secs,
            "neutral_time_secs": neut_secs,
            "top_sites": top_sites,
        })


class ProductivitySplitView(generics.GenericAPIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        today = timezone.now().date()
        logs = BrowsingLog.objects.filter(user=request.user, visited_at__date=today)
        total_secs = logs.aggregate(s=Sum('time_spent_secs'))['s'] or 0

        prod_secs = logs.filter(productivity_label='PRODUCTIVE').aggregate(s=Sum('time_spent_secs'))['s'] or 0
        dist_secs = logs.filter(productivity_label='DISTRACTING').aggregate(s=Sum('time_spent_secs'))['s'] or 0
        neut_secs = logs.filter(productivity_label='NEUTRAL').aggregate(s=Sum('time_spent_secs'))['s'] or 0

        prod_pct = round((prod_secs / total_secs * 100), 1) if total_secs > 0 else 0
        dist_pct = round((dist_secs / total_secs * 100), 1) if total_secs > 0 else 0
        neut_pct = round((neut_secs / total_secs * 100), 1) if total_secs > 0 else 0

        return Response({
            "total_secs": total_secs,
            "productive_pct": prod_pct,
            "distracting_pct": dist_pct,
            "neutral_pct": neut_pct,
        })


class SwitchEventCreateView(generics.CreateAPIView):
    """
    POST /api/browsing/switch/
    Records a context switch event from Chrome Extension.
    """
    permission_classes = [permissions.IsAuthenticated]
    serializer_class = SwitchEventSerializer

    def create(self, request, *args, **kwargs):
        from django.core.cache import cache
        cache.set(f"ext_active_{request.user.id}", timezone.now().timestamp(), 45)

        if not FocusSession.objects.filter(user=request.user, status='ACTIVE').exists():
            return Response({
                "status": "paused",
                "detail": "Tracking paused: No active focus session in progress."
            }, status=status.HTTP_200_OK)
        return super().create(request, *args, **kwargs)

    def perform_create(self, serializer):
        serializer.save(user=self.request.user)


class TodaySwitchSummaryView(generics.GenericAPIView):
    """
    GET /api/browsing/switches/today/
    Returns today's switch count and a list of switch events (browser + system).
    """
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        from apps.system_monitor.models import SystemSwitchEvent
        today = timezone.now().date()
        b_switches = SwitchEvent.objects.filter(user=request.user, switched_at__date=today)
        s_switches = SystemSwitchEvent.objects.filter(user=request.user, switched_at__date=today)

        total_switches = b_switches.count() + s_switches.count()

        # Combine top transitions
        b_trans = list(
            b_switches.values('from_domain', 'to_domain', 'from_category', 'to_category')
            .annotate(count=Count('id'))
        )
        s_trans = list(
            s_switches.values('from_app', 'to_app', 'from_category', 'to_category')
            .annotate(count=Count('id'))
        )

        transitions = []
        for t in b_trans:
            transitions.append({
                'from_domain': t['from_domain'],
                'to_domain': t['to_domain'],
                'from_category': t['from_category'],
                'to_category': t['to_category'],
                'count': t['count'],
                'source': 'browser'
            })
        for t in s_trans:
            transitions.append({
                'from_domain': t['from_app'],
                'to_domain': t['to_app'],
                'from_category': t['from_category'],
                'to_category': t['to_category'],
                'count': t['count'],
                'source': 'system'
            })
        transitions.sort(key=lambda x: x['count'], reverse=True)

        # Combine recent switches
        b_recent = list(
            b_switches.values(
                'from_domain', 'from_title', 'from_category',
                'to_domain', 'to_title', 'to_category', 'switched_at'
            )
        )
        s_recent = list(
            s_switches.values(
                'from_app', 'from_title', 'from_category',
                'to_app', 'to_title', 'to_category', 'switched_at'
            )
        )

        recent = []
        for r in b_recent:
            recent.append({
                'from_domain': r['from_domain'],
                'from_title': r['from_title'],
                'from_category': r['from_category'],
                'to_domain': r['to_domain'],
                'to_title': r['to_title'],
                'to_category': r['to_category'],
                'switched_at': r['switched_at'].isoformat() if r.get('switched_at') else '',
                'source': 'browser'
            })
        for r in s_recent:
            recent.append({
                'from_domain': r['from_app'],
                'from_title': r['from_title'],
                'from_category': r['from_category'],
                'to_domain': r['to_app'],
                'to_title': r['to_title'],
                'to_category': r['to_category'],
                'switched_at': r['switched_at'].isoformat() if r.get('switched_at') else '',
                'source': 'system'
            })
        recent.sort(key=lambda x: x['switched_at'], reverse=True)

        return Response({
            "date": str(today),
            "total_switches": total_switches,
            "browser_switches": b_switches.count(),
            "system_switches": s_switches.count(),
            "top_transitions": transitions[:12],
            "recent_switches": recent[:25]
        })

