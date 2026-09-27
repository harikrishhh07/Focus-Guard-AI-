from rest_framework import generics, viewsets, permissions, status
from rest_framework.response import Response
from django.shortcuts import redirect
from django.contrib.auth.models import User
from django.utils.decorators import method_decorator
from django.views.decorators.csrf import csrf_exempt
from .models import UserProfile, Goal
from rest_framework_simplejwt.views import TokenObtainPairView
from .serializers import (
    UserSerializer, UserProfileSerializer, RegisterSerializer, GoalSerializer,
    CustomTokenObtainPairSerializer
)


@method_decorator(csrf_exempt, name='dispatch')
class RegisterView(generics.CreateAPIView):
    queryset = User.objects.all()
    permission_classes = [permissions.AllowAny]
    serializer_class = RegisterSerializer


@method_decorator(csrf_exempt, name='dispatch')
class CustomTokenObtainPairView(TokenObtainPairView):
    permission_classes = [permissions.AllowAny]
    serializer_class = CustomTokenObtainPairSerializer


@method_decorator(csrf_exempt, name='dispatch')
class GoogleAuthView(generics.GenericAPIView):
    permission_classes = [permissions.AllowAny]

    def post(self, request):
        import requests
        import base64
        import json
        from django.contrib.auth.models import User
        from rest_framework_simplejwt.tokens import RefreshToken

        token = request.data.get('token') or request.data.get('credential') or request.data.get('id_token')
        email = request.data.get('email')
        name = request.data.get('name', '')

        if token:
            # 1. Try Google tokeninfo endpoint
            try:
                google_resp = requests.get(f'https://oauth2.googleapis.com/tokeninfo?id_token={token}', timeout=5)
                if google_resp.status_code == 200:
                    payload = google_resp.json()
                    email = payload.get('email', email)
                    name = payload.get('name', name)
            except Exception as e:
                print("Tokeninfo request error:", e)

            # 2. Fallback: decode JWT payload directly from token if email still missing
            if not email and token and '.' in token:
                try:
                    parts = token.split('.')
                    if len(parts) >= 2:
                        payload_b64 = parts[1]
                        payload_b64 = payload_b64.replace('-', '+').replace('_', '/')
                        payload_b64 += '=' * (-len(payload_b64) % 4)
                        payload_json = base64.b64decode(payload_b64).decode('utf-8')
                        payload = json.loads(payload_json)
                        email = payload.get('email', email)
                        name = payload.get('name', name)
                except Exception as ex:
                    print("Direct JWT decode error:", ex)

        if not email:
            return Response({'detail': 'Google Authentication failed. Valid token or email required.'}, status=status.HTTP_400_BAD_REQUEST)

        # Get existing user by email or create new unique user safely
        user = User.objects.filter(email__iexact=email).first()
        if not user:
            base_username = email.split('@')[0]
            username = base_username
            counter = 1
            while User.objects.filter(username__iexact=username).exists():
                username = f"{base_username}{counter}"
                counter += 1
            
            user = User.objects.create_user(
                username=username,
                email=email,
                first_name=name.split(' ')[0] if name else base_username,
                last_name=' '.join(name.split(' ')[1:]) if name and len(name.split(' ')) > 1 else ''
            )

        UserProfile.objects.get_or_create(user=user)

        refresh = RefreshToken.for_user(user)
        return Response({
            'access': str(refresh.access_token),
            'refresh': str(refresh),
            'username': user.username,
            'email': user.email,
        }, status=status.HTTP_200_OK)


@method_decorator(csrf_exempt, name='dispatch')
class GoogleAuthRedirectView(GoogleAuthView):
    """Accept GIS redirect-mode POSTs and return to the SPA Dashboard."""

    def post(self, request):
        from urllib.parse import quote

        response = super().post(request)
        if response.status_code != status.HTTP_200_OK:
            return response

        data = response.data
        fragment = '&'.join([
            f"google_access={quote(data['access'], safe='')}",
            f"google_refresh={quote(data['refresh'], safe='')}",
            f"google_user={quote(data.get('username', 'Google User'), safe='')}",
        ])
        return redirect(f'/?#{fragment}')


class ProfileView(generics.RetrieveUpdateAPIView):
    permission_classes = [permissions.IsAuthenticated]
    serializer_class = UserProfileSerializer

    def get_object(self):
        profile, _ = UserProfile.objects.get_or_create(user=self.request.user)
        return profile


class ExtensionDisconnectView(generics.GenericAPIView):
    """POST /api/auth/extension/disconnect/ — stop extension heartbeat & end active session."""
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        from django.core.cache import cache
        from django.utils import timezone
        from apps.focus_sessions.models import FocusSession
        from apps.system_monitor.models import SystemAppLog

        cache.delete(f"ext_active_{request.user.id}")

        # Close any open desktop app sessions (Chrome, etc.) immediately
        now = timezone.now()
        for open_log in SystemAppLog.objects.filter(user=request.user, ended_at__isnull=True):
            elapsed = max(1, int((now - open_log.started_at).total_seconds()))
            open_log.ended_at = now
            open_log.duration_secs = max(open_log.duration_secs or 0, elapsed)
            open_log.save(update_fields=['ended_at', 'duration_secs'])

        end_sessions = True
        if isinstance(request.data, dict) and request.data.get('end_sessions') is False:
            end_sessions = False

        ended = 0
        if end_sessions:
            active = FocusSession.objects.filter(user=request.user, status='ACTIVE')
            for session in active:
                elapsed = max(1, int((now - session.start_time).total_seconds() // 60))
                session.status = 'COMPLETED'
                session.end_time = now
                if not session.actual_duration_mins:
                    session.actual_duration_mins = elapsed
                session.save()
                ended += 1

        return Response({
            "status": "disconnected",
            "sessions_ended": ended,
            "detail": "Browsing & desktop telemetry stopped." + (
                " Active focus sessions were ended." if end_sessions else ""
            ),
        })


class ExtensionHeartbeatView(generics.GenericAPIView):
    """POST /api/auth/extension/heartbeat/ — mark extension as live for the dashboard."""
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        from django.core.cache import cache
        from django.utils import timezone
        cache.set(f"ext_active_{request.user.id}", timezone.now().timestamp(), 45)
        return Response({"status": "ok", "connected": True})


class ExtensionStatusClearView(generics.GenericAPIView):
    """POST /api/auth/extension/status/clear/ — drop stale Connected flag without ending sessions."""
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        from django.core.cache import cache
        from django.utils import timezone
        from apps.system_monitor.models import SystemAppLog

        cache.delete(f"ext_active_{request.user.id}")

        now = timezone.now()
        for open_log in SystemAppLog.objects.filter(user=request.user, ended_at__isnull=True):
            elapsed = max(1, int((now - open_log.started_at).total_seconds()))
            open_log.ended_at = now
            open_log.duration_secs = max(open_log.duration_secs or 0, elapsed)
            open_log.save(update_fields=['ended_at', 'duration_secs'])

        return Response({"status": "cleared", "connected": False})


class GoalViewSet(viewsets.ModelViewSet):
    permission_classes = [permissions.IsAuthenticated]
    serializer_class = GoalSerializer

    def get_queryset(self):
        return Goal.objects.filter(user=self.request.user).order_by('-created_at')

    def perform_create(self, serializer):
        serializer.save(user=self.request.user)
