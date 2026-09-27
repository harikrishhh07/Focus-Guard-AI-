from django.urls import path, include
from rest_framework.routers import DefaultRouter
from rest_framework_simplejwt.views import (
    TokenRefreshView,
)
from .views import RegisterView, ProfileView, GoalViewSet, GoogleAuthView, GoogleAuthRedirectView, CustomTokenObtainPairView, ExtensionDisconnectView, ExtensionHeartbeatView, ExtensionStatusClearView

router = DefaultRouter()
router.register(r'goals', GoalViewSet, basename='goal')

urlpatterns = [
    path('register/', RegisterView.as_view(), name='register'),
    path('google/', GoogleAuthView.as_view(), name='google_auth'),
    path('google/redirect/', GoogleAuthRedirectView.as_view(), name='google_auth_redirect'),
    path('token/', CustomTokenObtainPairView.as_view(), name='token_obtain_pair'),
    path('token/refresh/', TokenRefreshView.as_view(), name='token_refresh'),
    path('profile/', ProfileView.as_view(), name='profile'),
    path('extension/disconnect/', ExtensionDisconnectView.as_view(), name='extension-disconnect'),
    path('extension/heartbeat/', ExtensionHeartbeatView.as_view(), name='extension-heartbeat'),
    path('extension/status/clear/', ExtensionStatusClearView.as_view(), name='extension-status-clear'),
    path('', include(router.urls)),
]
