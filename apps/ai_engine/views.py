from rest_framework import generics, permissions, status
from rest_framework.response import Response
from django.utils import timezone
from .models import AIInsight, ClassificationCache
from .serializers import AIInsightSerializer, ClassificationCacheSerializer
from .llm.insight_generator import generate_attention_insight, classify_with_llm
from .rag.retriever import seed_knowledge_base


class GenerateInsightView(generics.GenericAPIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        insight = generate_attention_insight(request.user)
        return Response(AIInsightSerializer(insight).data, status=status.HTTP_201_CREATED)


class LatestInsightView(generics.GenericAPIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        today = timezone.now().date()
        insight = AIInsight.objects.filter(user=request.user, date_analyzed=today).order_by('-generated_at').first()
        if not insight:
            insight = generate_attention_insight(request.user)
        return Response(AIInsightSerializer(insight).data)


class ClassifyItemView(generics.GenericAPIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        identifier = request.data.get('identifier', '').strip()
        item_type = request.data.get('item_type', 'app')
        context = request.data.get('context', '')

        if not identifier:
            return Response({"error": "identifier is required"}, status=status.HTTP_400_BAD_REQUEST)

        result = classify_with_llm(identifier, item_type=item_type, context=context)
        return Response(result)


class SeedKnowledgeBaseView(generics.GenericAPIView):
    permission_classes = [permissions.IsAdminUser]

    def post(self, request):
        count = seed_knowledge_base()
        return Response({"message": f"Successfully seeded {count} knowledge documents into ChromaDB"})
