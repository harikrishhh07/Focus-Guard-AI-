from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import (
    FocusSessionViewSet,
    EndFocusSessionView,
    ActiveFocusSessionView,
    BlocklistView,
    BreakStartView,
    BreakEndView,
    BreakStatusView,
)

router = DefaultRouter()
router.register(r'sessions', FocusSessionViewSet, basename='focus-session')

urlpatterns = [
    path('active/', ActiveFocusSessionView.as_view(), name='focus-session-active'),
    path('blocklist/', BlocklistView.as_view(), name='focus-blocklist'),
    path('break/start/', BreakStartView.as_view(), name='focus-break-start'),
    path('break/end/', BreakEndView.as_view(), name='focus-break-end'),
    path('break/status/', BreakStatusView.as_view(), name='focus-break-status'),
    path('start/', FocusSessionViewSet.as_view({'post': 'create'}), name='focus-session-start'),
    path('end/',   EndFocusSessionView.as_view(), name='focus-session-end-active'),
    path('<int:pk>/end/', EndFocusSessionView.as_view(), name='focus-session-end-direct'),
    path('sessions/<int:pk>/end/', EndFocusSessionView.as_view(), name='focus-session-end'),
    path('', include(router.urls)),
]
