from django.urls import path
from .views import DashboardSummaryView, DateReportView
from .trends import TrendsView
from .export import CSVExportView
from .gamification import GamificationView
from .pdf_report import PDFReportView

urlpatterns = [
    path('summary/', DashboardSummaryView.as_view(), name='dashboard-summary'),
    path('report/', DateReportView.as_view(), name='dashboard-report'),
    path('report/pdf/', PDFReportView.as_view(), name='dashboard-report-pdf'),
    path('trends/', TrendsView.as_view(), name='dashboard-trends'),
    path('export/csv/', CSVExportView.as_view(), name='dashboard-export-csv'),
    path('gamification/', GamificationView.as_view(), name='dashboard-gamification'),
]
