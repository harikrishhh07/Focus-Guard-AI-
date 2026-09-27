from django.test import TestCase
from django.contrib.auth.models import User
from django.utils import timezone
from rest_framework.test import APIClient
from apps.focus_sessions.models import FocusSession
from apps.system_monitor.models import AttentionLog, SystemAppLog, SystemSwitchEvent


class AttentionTrackingTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(username='testvision', password='password123')
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def test_post_attention_focused(self):
        payload = {
            'state': 'FOCUSED',
            'pitch': 2.5,
            'yaw': -1.0,
            'roll': 0.0,
            'attention_score': 95.0,
            'duration_secs': 3,
            'face_detected': True,
            'emotion': 'neutral',
            'timestamp': timezone.now().isoformat(),
        }
        res = self.client.post('/api/system/attention/', payload, format='json')
        self.assertEqual(res.status_code, 201)
        self.assertEqual(res.data['state'], 'FOCUSED')
        self.assertEqual(AttentionLog.objects.count(), 1)


class DesktopTrackingTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(username='desktopuser', password='password123')
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def test_desktop_log_is_recorded_without_focus_session(self):
        payload = {
            'process_name': 'Code',
            'app_name': 'Visual Studio Code',
            'window_title': 'Focus Guard AI',
            'exe_path': '/Applications/Visual Studio Code.app',
            'category': 'DEVELOPMENT',
            'productivity_label': 'PRODUCTIVE',
            'confidence_score': 1.0,
            'started_at': timezone.now().isoformat(),
            'duration_secs': 1,
        }
        response = self.client.post('/api/system/log/', payload, format='json')

        self.assertEqual(response.status_code, 201)
        self.assertEqual(SystemAppLog.objects.count(), 1)

    def test_desktop_switch_is_recorded_without_focus_session(self):
        payload = {
            'from_process': 'Code',
            'from_app': 'Visual Studio Code',
            'from_title': 'Focus Guard AI',
            'from_category': 'DEVELOPMENT',
            'to_process': 'Terminal',
            'to_app': 'Terminal',
            'to_title': 'zsh',
            'to_category': 'DEVELOPMENT',
            'switched_at': timezone.now().isoformat(),
        }
        response = self.client.post('/api/system/switch/', payload, format='json')

        self.assertEqual(response.status_code, 201)
        self.assertEqual(SystemSwitchEvent.objects.count(), 1)

    def test_phone_distraction_updates_active_session(self):
        # Create an active focus session
        session = FocusSession.objects.create(
            user=self.user,
            start_time=timezone.now(),
            status='ACTIVE',
            productive_secs=100,
            distracted_secs=0,
            interruptions=0,
        )

        payload = {
            'state': 'LOOKING_AT_PHONE',
            'pitch': -18.0,
            'yaw': 2.0,
            'roll': 0.0,
            'attention_score': 25.0,
            'duration_secs': 5,
            'face_detected': True,
            'emotion': 'neutral',
            'timestamp': timezone.now().isoformat(),
        }
        res = self.client.post('/api/system/attention/', payload, format='json')
        self.assertEqual(res.status_code, 201)

        # Refresh session
        session.refresh_from_db()
        self.assertEqual(session.distracted_secs, 5)
        self.assertEqual(session.interruptions, 1)

    def test_live_attention_view(self):
        FocusSession.objects.create(
            user=self.user,
            start_time=timezone.now(),
            status='ACTIVE'
        )
        # Post a recent log
        AttentionLog.objects.create(
            user=self.user,
            state='LOOKING_AT_PHONE',
            pitch=-15.0,
            yaw=0.0,
            attention_score=30.0,
            duration_secs=5,
            face_detected=True,
            emotion='neutral',
            timestamp=timezone.now(),
        )

        res = self.client.get('/api/system/attention/live/')
        self.assertEqual(res.status_code, 200)
        self.assertTrue(res.data['is_active'])
        self.assertEqual(res.data['state'], 'LOOKING_AT_PHONE')
        self.assertEqual(res.data['phone_distraction_count'], 1)
