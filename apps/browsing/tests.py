from django.test import TestCase
from django.contrib.auth.models import User
from rest_framework.test import APIClient
from apps.browsing.models import BrowsingLog
from django.utils import timezone


class FocusGuardAPITests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(username='testuser', password='password123')
        res = self.client.post('/api/auth/token/', {'username': 'testuser', 'password': 'password123'})
        self.token = res.data['access']
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {self.token}')

    def test_browsing_logging(self):
        now = timezone.now()
        payload = {
            'url': 'https://www.youtube.com/watch?v=123',
            'domain': 'youtube.com',
            'page_title': 'Django & React Full Course - YouTube',
            'visited_at': now.isoformat(),
            'time_spent_secs': 300,
            'category': 'DEVELOPMENT',
            'productivity_label': 'PRODUCTIVE',
            'confidence_score': 0.95
        }
        res = self.client.post('/api/browsing/log/', payload, format='json')
        self.assertIn(res.status_code, [200, 201])
        self.assertEqual(BrowsingLog.objects.filter(user=self.user).count(), 1)

    def test_dashboard_summary(self):
        res = self.client.get('/api/dashboard/summary/')
        self.assertEqual(res.status_code, 200)
        self.assertIn('category_breakdown', res.data)
        self.assertIn('productive_pct', res.data)

    def test_goals_crud(self):
        # Create
        create_res = self.client.post('/api/auth/goals/', {'title': 'Study Machine Learning', 'target_focus_hours': 12.0})
        self.assertEqual(create_res.status_code, 201)
        goal_id = create_res.data['id']

        # List
        list_res = self.client.get('/api/auth/goals/')
        self.assertEqual(list_res.status_code, 200)
        self.assertEqual(len(list_res.data), 1)

        # Delete
        del_res = self.client.delete(f'/api/auth/goals/{goal_id}/')
        self.assertEqual(del_res.status_code, 204)
