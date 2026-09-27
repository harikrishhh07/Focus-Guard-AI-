from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import (
    BrowsingLogViewSet, TodayBrowsingSummaryView,
    ProductivitySplitView, SwitchEventCreateView, TodaySwitchSummaryView
)

router = DefaultRouter()
router.register(r'logs', BrowsingLogViewSet, basename='browsing-log')

urlpatterns = [
    path('log/', BrowsingLogViewSet.as_view({'post': 'create'}), name='browsing-log-create'),
    path('today/', TodayBrowsingSummaryView.as_view(), name='browsing-today'),
    path('productivity-split/', ProductivitySplitView.as_view(), name='browsing-productivity-split'),
    path('switch/', SwitchEventCreateView.as_view(), name='browsing-switch-create'),
    path('switches/today/', TodaySwitchSummaryView.as_view(), name='browsing-switches-today'),
    path('', include(router.urls)),
]
