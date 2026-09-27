from django.db import models
from django.contrib.auth.models import User


class AIInsight(models.Model):
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='ai_insights')
    generated_at = models.DateTimeField(auto_now_add=True)
    date_analyzed = models.DateField()
    focus_score = models.FloatField(default=0.0)
    productivity_score = models.FloatField(default=0.0)
    distraction_score = models.FloatField(default=0.0)
    top_distractors = models.JSONField(default=list, blank=True)
    insights_text = models.TextField()
    recommendations = models.JSONField(default=list, blank=True)
    retrieved_chunks = models.JSONField(default=list, blank=True)
    llm_model_used = models.CharField(max_length=100, default='mistralai/Mistral-7B-Instruct-v0.2')

    def __str__(self):
        return f"Insight for {self.user.username} on {self.date_analyzed}"


class ClassificationCache(models.Model):
    """Caches LLM classifications for unknown apps and URLs to avoid repeated calls."""
    identifier = models.CharField(max_length=255, unique=True, db_index=True)  # app name or domain
    item_type = models.CharField(max_length=20, default='app')  # 'app' or 'domain'
    category = models.CharField(max_length=50)
    productivity_label = models.CharField(max_length=20)
    confidence_score = models.FloatField(default=1.0)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"{self.identifier} -> {self.category} ({self.productivity_label})"
