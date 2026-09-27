from rest_framework import serializers
from .models import BrowsingLog, BrowsingSession, SwitchEvent


class BrowsingLogSerializer(serializers.ModelSerializer):
    class Meta:
        model = BrowsingLog
        fields = [
            'id', 'url', 'domain', 'page_title', 'visited_at',
            'time_spent_secs', 'category', 'productivity_label',
            'confidence_score', 'created_at'
        ]
        read_only_fields = ['id', 'created_at']


class BrowsingSessionSerializer(serializers.ModelSerializer):
    class Meta:
        model = BrowsingSession
        fields = ['id', 'domain', 'session_start', 'session_end', 'total_time_secs', 'productivity_label', 'page_count', 'created_at']
        read_only_fields = ['id', 'created_at']


class SwitchEventSerializer(serializers.ModelSerializer):
    class Meta:
        model = SwitchEvent
        fields = [
            'id', 'from_domain', 'from_title', 'from_category',
            'to_domain', 'to_title', 'to_category',
            'switched_at', 'created_at'
        ]
        read_only_fields = ['id', 'created_at']
