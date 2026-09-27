from rest_framework import serializers
from .models import SystemAppLog, SystemSwitchEvent, AttentionLog


class SystemAppLogSerializer(serializers.ModelSerializer):
    class Meta:
        model = SystemAppLog
        fields = [
            'id', 'process_name', 'app_name', 'window_title', 'exe_path',
            'category', 'productivity_label', 'confidence_score',
            'started_at', 'ended_at', 'duration_secs', 'created_at'
        ]
        read_only_fields = ['id', 'created_at']


class SystemSwitchEventSerializer(serializers.ModelSerializer):
    class Meta:
        model = SystemSwitchEvent
        fields = [
            'id',
            'from_process', 'from_app', 'from_title', 'from_category',
            'to_process',   'to_app',   'to_title',   'to_category',
            'switched_at',  'created_at'
        ]
        read_only_fields = ['id', 'created_at']


class AttentionLogSerializer(serializers.ModelSerializer):
    class Meta:
        model = AttentionLog
        fields = [
            'id', 'state', 'pitch', 'yaw', 'roll',
            'attention_score', 'duration_secs', 'face_detected',
            'emotion', 'timestamp', 'created_at'
        ]
        read_only_fields = ['id', 'created_at']

