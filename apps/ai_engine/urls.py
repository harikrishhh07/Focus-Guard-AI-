from django.urls import path
from .views import GenerateInsightView, LatestInsightView, ClassifyItemView, SeedKnowledgeBaseView

urlpatterns = [
    path('generate-insight/', GenerateInsightView.as_view(), name='ai-generate-insight'),
    path('insights/latest/', LatestInsightView.as_view(), name='ai-insights-latest'),
    path('classify/', ClassifyItemView.as_view(), name='ai-classify-item'),
    path('seed-knowledge/', SeedKnowledgeBaseView.as_view(), name='ai-seed-knowledge'),
]
