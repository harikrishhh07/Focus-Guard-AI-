from rest_framework import serializers
from .models import FocusSession


class FocusSessionSerializer(serializers.ModelSerializer):
    class Meta:
        model = FocusSession
        fields = [
            'id', 'start_time', 'end_time', 'planned_duration_mins',
            'actual_duration_mins', 'interruptions', 'session_type',
            'productive_secs', 'distracted_secs', 'switches_count', 'productivity_score',
            'notes', 'focus_score', 'status', 'created_at'
        ]
        read_only_fields = ['id', 'start_time', 'created_at']
