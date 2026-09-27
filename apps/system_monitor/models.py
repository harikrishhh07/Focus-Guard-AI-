from django.db import models
from django.contrib.auth.models import User


APP_CATEGORIES = [
    ('DEVELOPMENT',   'Development / Coding'),
    ('PRODUCTIVE',    'Productive / Work'),
    ('CREATIVE',      'Creative'),
    ('COMMUNICATION', 'Communication'),
    ('BROWSER',       'Web Browser'),
    ('ENTERTAINMENT', 'Entertainment / Media'),
    ('GAMING',        'Gaming'),
    ('SOCIAL_MEDIA',  'Social Media'),
    ('SYSTEM',        'System / Utility'),
    ('EDUCATION',     'Education / Learning'),
    ('FINANCE',       'Finance'),
    ('SHOPPING',      'Shopping'),
]

PRODUCTIVITY_TIERS = [
    ('PRODUCTIVE',   'Productive'),
    ('NEUTRAL',      'Neutral'),
    ('DISTRACTING',  'Distracting'),
]


class SystemAppLog(models.Model):
    """
    Each record = one active-window session on the user's system.
    Written by the desktop_agent.py script every time the active app changes.
    """
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='system_logs')

    process_name   = models.CharField(max_length=255, db_index=True)   # e.g. "Code.exe"
    app_name       = models.CharField(max_length=255)                   # e.g. "Visual Studio Code"
    window_title   = models.CharField(max_length=512, blank=True, default='')  # full window title
    exe_path       = models.CharField(max_length=1024, blank=True, default='')

    category            = models.CharField(max_length=50, choices=APP_CATEGORIES, default='SYSTEM')
    productivity_label  = models.CharField(max_length=20, choices=PRODUCTIVITY_TIERS, default='NEUTRAL')
    confidence_score    = models.FloatField(default=1.0)

    started_at  = models.DateTimeField()          # when this app became active
    ended_at    = models.DateTimeField(null=True, blank=True)  # when it lost focus
    duration_secs = models.IntegerField(default=0)  # computed duration

    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-started_at']
        indexes  = [models.Index(fields=['user', 'started_at'])]

    def __str__(self):
        return f"{self.user.username} · {self.app_name} ({self.duration_secs}s)"


class SystemSwitchEvent(models.Model):
    """
    Records every system-level context switch: from app A to app B.
    """
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='system_switches')

    from_process   = models.CharField(max_length=255, blank=True, default='')
    from_app       = models.CharField(max_length=255, blank=True, default='')
    from_title     = models.CharField(max_length=512, blank=True, default='')
    from_category  = models.CharField(max_length=50,  blank=True, default='')

    to_process     = models.CharField(max_length=255, blank=True, default='')
    to_app         = models.CharField(max_length=255, blank=True, default='')
    to_title       = models.CharField(max_length=512, blank=True, default='')
    to_category    = models.CharField(max_length=50,  blank=True, default='')

    switched_at    = models.DateTimeField()
    created_at     = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-switched_at']

    def __str__(self):
        return f"{self.user.username}: {self.from_app} → {self.to_app}"


ATTENTION_STATES = [
    ('FOCUSED',           'Focused on Screen'),
    ('LOOKING_AT_PHONE',  'Distracted (Looking Down / Phone)'),
    ('LOOKING_AWAY',      'Distracted (Looking Away)'),
    ('USER_ABSENT',       'User Absent / Away from Desk'),
    ('DROWSY',            'Drowsy / Fatigue Detected'),
]


class AttentionLog(models.Model):
    """
    Records real-time facial orientation and attention state from the vision tracker.
    Helps detect 'phantom productivity' (e.g. user scrolling on phone while work app is open).
    """
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='attention_logs')
    session = models.ForeignKey(
        'focus_sessions.FocusSession',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='attention_logs'
    )

    state = models.CharField(max_length=30, choices=ATTENTION_STATES, default='FOCUSED', db_index=True)
    pitch = models.FloatField(default=0.0)             # Negative = tilted down towards phone
    yaw = models.FloatField(default=0.0)               # Turned left / right
    roll = models.FloatField(default=0.0)
    attention_score = models.FloatField(default=100.0) # 0 to 100
    duration_secs = models.IntegerField(default=3)     # Duration of this detected slice
    face_detected = models.BooleanField(default=True)
    emotion = models.CharField(max_length=50, blank=True, default='')

    timestamp = models.DateTimeField(db_index=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-timestamp']
        indexes = [models.Index(fields=['user', 'timestamp'])]

    def __str__(self):
        return f"{self.user.username} · {self.state} ({self.attention_score:.0f}%)"

