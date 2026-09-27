from django.db import models
from django.contrib.auth.models import User


class UserProfile(models.Model):
    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name='profile')
    occupation = models.CharField(max_length=100, blank=True, default='')
    daily_focus_goal_hours = models.FloatField(default=6.0)
    work_start_time = models.CharField(max_length=10, default='09:00')
    work_end_time = models.CharField(max_length=10, default='18:00')
    timezone = models.CharField(max_length=50, default='UTC')
    focus_preferences = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"Profile of {self.user.username}"


class Goal(models.Model):
    STATUS_CHOICES = [
        ('ACTIVE', 'Active'),
        ('COMPLETED', 'Completed'),
        ('ABANDONED', 'Abandoned'),
    ]

    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='goals')
    title = models.CharField(max_length=255)
    description = models.TextField(blank=True, default='')
    target_focus_hours = models.FloatField(default=25.0)
    current_focus_hours = models.FloatField(default=0.0)
    target_date = models.DateField(null=True, blank=True)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='ACTIVE')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"{self.title} ({self.user.username})"
