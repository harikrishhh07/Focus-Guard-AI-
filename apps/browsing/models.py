from django.db import models
from django.contrib.auth.models import User


class BrowsingLog(models.Model):
    CATEGORY_CHOICES = [
        ('PRODUCTIVE', 'Productive'),
        ('DEVELOPMENT', 'Development'),
        ('EDUCATION', 'Education'),
        ('CREATIVE', 'Creative'),
        ('COMMUNICATION', 'Communication'),
        ('FINANCE', 'Finance'),
        ('SYSTEM', 'System'),
        ('NEWS_READING', 'News & Reading'),
        ('ENTERTAINMENT', 'Entertainment'),
        ('SOCIAL_MEDIA', 'Social Media'),
        ('GAMING', 'Gaming'),
        ('SHOPPING', 'Shopping'),
    ]

    PRODUCTIVITY_TIERS = [
        ('PRODUCTIVE', 'Productive'),
        ('NEUTRAL', 'Neutral'),
        ('DISTRACTING', 'Distracting'),
    ]

    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='browsing_logs')
    url = models.URLField(max_length=1024)
    domain = models.CharField(max_length=255, db_index=True)
    page_title = models.CharField(max_length=512, blank=True, default='')
    visited_at = models.DateTimeField()
    time_spent_secs = models.IntegerField(default=0)
    category = models.CharField(max_length=50, choices=CATEGORY_CHOICES, default='SYSTEM')
    productivity_label = models.CharField(max_length=20, choices=PRODUCTIVITY_TIERS, default='NEUTRAL')
    confidence_score = models.FloatField(default=1.0)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"{self.user.username} - {self.domain} ({self.time_spent_secs}s)"


class BrowsingSession(models.Model):
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='browsing_sessions')
    domain = models.CharField(max_length=255)
    session_start = models.DateTimeField()
    session_end = models.DateTimeField()
    total_time_secs = models.IntegerField(default=0)
    productivity_label = models.CharField(max_length=20, default='NEUTRAL')
    page_count = models.IntegerField(default=1)
    created_at = models.DateTimeField(auto_now_add=True)


class SwitchEvent(models.Model):
    """
    Records every context switch: from which domain/tab to which domain/tab.
    This powers the Switch Count analytics.
    """
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='switch_events')
    from_domain = models.CharField(max_length=255, blank=True, default='')
    from_title = models.CharField(max_length=512, blank=True, default='')
    from_category = models.CharField(max_length=50, blank=True, default='')
    to_domain = models.CharField(max_length=255, blank=True, default='')
    to_title = models.CharField(max_length=512, blank=True, default='')
    to_category = models.CharField(max_length=50, blank=True, default='')
    switched_at = models.DateTimeField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-switched_at']

    def __str__(self):
        return f"{self.user.username}: {self.from_domain} → {self.to_domain} at {self.switched_at}"
