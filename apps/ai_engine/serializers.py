from rest_framework import serializers
from .models import AIInsight, ClassificationCache


class AIInsightSerializer(serializers.ModelSerializer):
    class Meta:
        model = AIInsight
        fields = [
            'id', 'generated_at', 'date_analyzed', 'focus_score',
            'productivity_score', 'distraction_score', 'top_distractors',
            'insights_text', 'recommendations', 'retrieved_chunks', 'llm_model_used'
        ]
        read_only_fields = ['id', 'generated_at']


class ClassificationCacheSerializer(serializers.ModelSerializer):
    class Meta:
        model = ClassificationCache
        fields = ['id', 'identifier', 'item_type', 'category', 'productivity_label', 'confidence_score', 'created_at']
