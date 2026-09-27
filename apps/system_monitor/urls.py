from django.urls import path
from .views import (
    SystemAppLogCreateView, SystemSwitchCreateView,
    SystemTodaySummaryView, SystemLiveView,
    AttentionLogCreateView, AttentionLiveView
)

urlpatterns = [
    path('log/',            SystemAppLogCreateView.as_view(),  name='system-log-create'),
    path('switch/',         SystemSwitchCreateView.as_view(),  name='system-switch-create'),
    path('today/',          SystemTodaySummaryView.as_view(),  name='system-today'),
    path('live/',           SystemLiveView.as_view(),          name='system-live'),
    path('attention/',      AttentionLogCreateView.as_view(),  name='attention-log-create'),
    path('attention/live/', AttentionLiveView.as_view(),       name='attention-live'),
]

