from django.db import models
from django.contrib.auth.models import User


class FocusSession(models.Model):
    SESSION_TYPES = [
        ('DEEP_WORK', 'Deep Work'),
        ('POMODORO', 'Pomodoro'),
        ('STUDY', 'Study'),
        ('MEETING', 'Meeting'),
    ]

    STATUS_CHOICES = [
        ('ACTIVE', 'Active'),
        ('COMPLETED', 'Completed'),
        ('ABANDONED', 'Abandoned'),
    ]

    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='focus_sessions')
    start_time = models.DateTimeField()
    end_time = models.DateTimeField(null=True, blank=True)
    planned_duration_mins = models.IntegerField(default=25)
    actual_duration_mins = models.IntegerField(null=True, blank=True)
    interruptions = models.IntegerField(default=0)
    session_type = models.CharField(max_length=50, choices=SESSION_TYPES, default='POMODORO')
    notes = models.TextField(blank=True, default='')
    focus_score = models.FloatField(null=True, blank=True)
    productive_secs = models.IntegerField(default=0)
    distracted_secs = models.IntegerField(default=0)
    switches_count = models.IntegerField(default=0)
    productivity_score = models.FloatField(default=0.0)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='ACTIVE')
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"{self.user.username} - {self.session_type} ({self.status})"
