"""Generate a downloadable FocusGuard PDF report for a given date."""

from datetime import datetime
from io import BytesIO

from django.db.models import Sum
from django.http import HttpResponse
from django.utils import timezone
from rest_framework import generics, permissions
from rest_framework.response import Response

from apps.ai_engine.models import AIInsight
from apps.browsing.models import BrowsingLog, SwitchEvent
from apps.focus_sessions.models import FocusSession
from apps.system_monitor.models import SystemAppLog, SystemSwitchEvent
from .views import format_duration


def _build_report_data(user, target_date):
    b_logs = BrowsingLog.objects.filter(user=user, visited_at__date=target_date)
    b_total = b_logs.aggregate(s=Sum('time_spent_secs'))['s'] or 0
    b_prod = b_logs.filter(productivity_label='PRODUCTIVE').aggregate(s=Sum('time_spent_secs'))['s'] or 0
    b_dist = b_logs.filter(productivity_label='DISTRACTING').aggregate(s=Sum('time_spent_secs'))['s'] or 0

    s_logs = SystemAppLog.objects.filter(user=user, started_at__date=target_date)
    s_total = s_logs.aggregate(s=Sum('duration_secs'))['s'] or 0
    s_prod = s_logs.filter(productivity_label='PRODUCTIVE').aggregate(s=Sum('duration_secs'))['s'] or 0
    s_dist = s_logs.filter(productivity_label='DISTRACTING').aggregate(s=Sum('duration_secs'))['s'] or 0

    total_switches = (
        SwitchEvent.objects.filter(user=user, switched_at__date=target_date).count()
        + SystemSwitchEvent.objects.filter(user=user, switched_at__date=target_date).count()
    )

    total_secs = b_total + s_total
    prod_secs = b_prod + s_prod
    dist_secs = b_dist + s_dist
    prod_pct = round(min(100.0, (prod_secs / total_secs) * 100), 1) if total_secs else None

    if total_secs == 0:
        verdict = 'NO ACTIVITY'
        reason = 'No active telemetry recorded for this date.'
    elif dist_secs == 0 or (prod_pct is not None and prod_pct >= 60.0 and total_switches < 40):
        verdict = 'HIGHLY PRODUCTIVE'
        reason = f'Excellent concentration with {format_duration(prod_secs)} of productive work.'
    elif (prod_pct is not None and dist_secs > prod_secs) or total_switches >= 40:
        verdict = 'DISTRACTED'
        reason = f'Significant distraction detected ({format_duration(dist_secs)}).'
    else:
        verdict = 'MODERATE FOCUS'
        reason = f'Balanced day with {format_duration(prod_secs)} productive and {format_duration(dist_secs)} distracted.'

    sessions = list(
        FocusSession.objects.filter(user=user, start_time__date=target_date)
        .order_by('start_time')
        .values('session_type', 'start_time', 'end_time', 'actual_duration_mins',
                'productive_secs', 'distracted_secs', 'switches_count', 'productivity_score')
    )
    top_apps = list(
        s_logs.values('app_name', 'category', 'productivity_label')
        .annotate(total_secs=Sum('duration_secs'))
        .order_by('-total_secs')[:10]
    )
    top_sites = list(
        b_logs.values('domain', 'category', 'productivity_label')
        .annotate(total_secs=Sum('time_spent_secs'))
        .order_by('-total_secs')[:10]
    )
    insight = AIInsight.objects.filter(user=user, date_analyzed=target_date).order_by('-generated_at').first()

    display_name = (user.get_full_name() or user.username or 'User').strip()
    generated_at = timezone.localtime()

    return {
        'date': str(target_date),
        'user_name': display_name,
        'username': user.username,
        'email': user.email or '',
        'first_name': user.first_name or '',
        'last_name': user.last_name or '',
        'verdict': verdict,
        'reason': reason,
        'productive_secs': prod_secs,
        'distracted_secs': dist_secs,
        'total_secs': total_secs,
        'productivity_score': prod_pct,
        'total_switches': total_switches,
        'sessions': sessions,
        'top_apps': top_apps,
        'top_sites': top_sites,
        'insight_text': (insight.insights_text if insight else '') or '',
        'generated_at': generated_at.isoformat(),
        'generated_at_display': generated_at.strftime('%d %b %Y · %I:%M %p %Z').strip(),
    }


def _logo_drawing(size=28):
    """Draw the FocusGuard shield mark for the PDF header."""
    from reportlab.graphics.shapes import Drawing, Polygon, Circle, String
    from reportlab.lib import colors

    d = Drawing(size, size)
    # Shield outline
    d.add(Polygon(
        [size * 0.5, size * 0.05,
         size * 0.92, size * 0.22,
         size * 0.92, size * 0.55,
         size * 0.5, size * 0.95,
         size * 0.08, size * 0.55,
         size * 0.08, size * 0.22],
        fillColor=colors.HexColor('#6366f1'),
        strokeColor=colors.HexColor('#4f46e5'),
        strokeWidth=0.5,
    ))
    d.add(Circle(size * 0.5, size * 0.48, size * 0.14,
                 fillColor=colors.white, strokeColor=None))
    return d


def _draw_pdf(data: dict) -> bytes:
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
    from reportlab.lib.units import mm
    from reportlab.platypus import (
        HRFlowable, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle
    )

    buffer = BytesIO()
    doc = SimpleDocTemplate(
        buffer,
        pagesize=A4,
        leftMargin=16 * mm,
        rightMargin=16 * mm,
        topMargin=14 * mm,
        bottomMargin=14 * mm,
        title=f"FocusGuard Report — {data['date']}",
        author=data.get('user_name') or data.get('username') or 'FocusGuard AI',
    )

    styles = getSampleStyleSheet()
    brand = ParagraphStyle(
        'FGBrand', parent=styles['Normal'], fontSize=16, leading=20,
        textColor=colors.HexColor('#0f1117'), fontName='Helvetica-Bold',
    )
    tagline = ParagraphStyle(
        'FGTag', parent=styles['Normal'], fontSize=8, textColor=colors.HexColor('#676e8c'),
    )
    meta = ParagraphStyle(
        'FGMeta', parent=styles['Normal'], fontSize=9, leading=13,
        textColor=colors.HexColor('#4a4f6a'),
    )
    h2 = ParagraphStyle(
        'FGH2', parent=styles['Heading2'], fontSize=11, spaceBefore=12, spaceAfter=6,
        textColor=colors.HexColor('#1e2030'), fontName='Helvetica-Bold',
    )
    body = ParagraphStyle(
        'FGBody', parent=styles['Normal'], fontSize=10, leading=14,
        textColor=colors.HexColor('#2d3048'),
    )
    small = ParagraphStyle(
        'FGSmall', parent=styles['Normal'], fontSize=8, textColor=colors.HexColor('#8890ab'),
    )

    story = []

    # ── Header: logo + brand + user + generated time ──
    logo = _logo_drawing(34)
    header_left = Table(
        [[logo, Paragraph(
            '<font color="#0f1117"><b>FocusGuard AI</b></font><br/>'
            '<font size="8" color="#676e8c">Attention Intelligence Platform</font>',
            brand
        )]],
        colWidths=[14 * mm, 70 * mm],
    )
    header_left.setStyle(TableStyle([
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('LEFTPADDING', (0, 0), (-1, -1), 0),
        ('RIGHTPADDING', (0, 0), (-1, -1), 4),
    ]))

    user_block = (
        f"<b>{data['user_name']}</b><br/>"
        f"@{data['username']}"
        + (f"<br/>{data['email']}" if data.get('email') else '')
        + f"<br/><font size='8' color='#676e8c'>Report date: {data['date']}</font>"
        + f"<br/><font size='8' color='#676e8c'>Generated: {data.get('generated_at_display') or ''}</font>"
    )
    header_right = Paragraph(user_block, meta)

    header = Table([[header_left, header_right]], colWidths=[95 * mm, 80 * mm])
    header.setStyle(TableStyle([
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('ALIGN', (1, 0), (1, 0), 'RIGHT'),
        ('LEFTPADDING', (0, 0), (-1, -1), 0),
        ('RIGHTPADDING', (0, 0), (-1, -1), 0),
    ]))
    story.append(header)
    story.append(Spacer(1, 6))
    story.append(HRFlowable(width='100%', thickness=1.2, color=colors.HexColor('#6366f1'), spaceAfter=10))

    story.append(Paragraph('Daily Focus Report', ParagraphStyle(
        'FGReportTitle', parent=styles['Heading1'], fontSize=14, textColor=colors.HexColor('#0f1117'),
        spaceAfter=4, fontName='Helvetica-Bold',
    )))
    story.append(Paragraph(f"<b>Verdict:</b> {data['verdict']}", body))
    story.append(Paragraph(data['reason'], body))
    story.append(Spacer(1, 8))

    score = '—' if data['productivity_score'] is None else f"{round(data['productivity_score'])}%"
    metrics = [
        ['Productive Time', 'Distracted Time', 'Context Switches', 'Productivity Score'],
        [
            format_duration(data['productive_secs']),
            format_duration(data['distracted_secs']),
            str(data['total_switches']),
            score,
        ],
    ]
    t = Table(metrics, colWidths=[42 * mm, 42 * mm, 42 * mm, 42 * mm])
    t.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#eef2ff')),
        ('TEXTCOLOR', (0, 0), (-1, 0), colors.HexColor('#4338ca')),
        ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
        ('FONTSIZE', (0, 0), (-1, -1), 9),
        ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
        ('GRID', (0, 0), (-1, -1), 0.4, colors.HexColor('#c7d2fe')),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 8),
        ('TOPPADDING', (0, 0), (-1, -1), 8),
        ('FONTNAME', (0, 1), (-1, 1), 'Helvetica-Bold'),
        ('TEXTCOLOR', (0, 1), (-1, 1), colors.HexColor('#0f1117')),
        ('BACKGROUND', (0, 1), (-1, 1), colors.HexColor('#f8f9fc')),
    ]))
    story.append(t)

    story.append(Paragraph('Focus Sessions', h2))
    sessions = data['sessions']
    if not sessions:
        story.append(Paragraph('No focus sessions logged on this date.', body))
    else:
        rows = [['#', 'Type', 'Duration', 'Switches', 'Score']]
        for i, s in enumerate(sessions, 1):
            rows.append([
                str(i),
                s.get('session_type') or 'Deep Work',
                f"{s.get('actual_duration_mins') or 0}m",
                str(s.get('switches_count') or 0),
                f"{round(s.get('productivity_score') or 0)}%",
            ])
        st = Table(rows, colWidths=[12 * mm, 50 * mm, 30 * mm, 30 * mm, 30 * mm])
        st.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#f1f3f9')),
            ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
            ('FONTSIZE', (0, 0), (-1, -1), 9),
            ('GRID', (0, 0), (-1, -1), 0.3, colors.HexColor('#e4e8f3')),
            ('TOPPADDING', (0, 0), (-1, -1), 5),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 5),
        ]))
        story.append(st)

    story.append(Paragraph('Top Desktop Apps', h2))
    apps = data['top_apps']
    if not apps:
        story.append(Paragraph('No desktop app activity on this date.', body))
    else:
        rows = [['App', 'Category', 'Label', 'Time']]
        for a in apps:
            rows.append([
                (a.get('app_name') or '—')[:36],
                a.get('category') or '—',
                a.get('productivity_label') or '—',
                format_duration(a.get('total_secs') or 0),
            ])
        at = Table(rows, colWidths=[55 * mm, 35 * mm, 35 * mm, 30 * mm])
        at.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#f1f3f9')),
            ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
            ('FONTSIZE', (0, 0), (-1, -1), 9),
            ('GRID', (0, 0), (-1, -1), 0.3, colors.HexColor('#e4e8f3')),
            ('TOPPADDING', (0, 0), (-1, -1), 5),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 5),
        ]))
        story.append(at)

    story.append(Paragraph('Top Websites', h2))
    sites = data['top_sites']
    if not sites:
        story.append(Paragraph('No browsing activity on this date.', body))
    else:
        rows = [['Domain', 'Category', 'Label', 'Time']]
        for s in sites:
            rows.append([
                (s.get('domain') or '—')[:36],
                s.get('category') or '—',
                s.get('productivity_label') or '—',
                format_duration(s.get('total_secs') or 0),
            ])
        wt = Table(rows, colWidths=[55 * mm, 35 * mm, 35 * mm, 30 * mm])
        wt.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#f1f3f9')),
            ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
            ('FONTSIZE', (0, 0), (-1, -1), 9),
            ('GRID', (0, 0), (-1, -1), 0.3, colors.HexColor('#e4e8f3')),
            ('TOPPADDING', (0, 0), (-1, -1), 5),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 5),
        ]))
        story.append(wt)

    if data.get('insight_text'):
        story.append(Paragraph('AI Insight', h2))
        story.append(Paragraph(data['insight_text'].replace('\n', '<br/>'), body))

    story.append(Spacer(1, 18))
    story.append(HRFlowable(width='100%', thickness=0.6, color=colors.HexColor('#e4e8f3'), spaceAfter=6))
    story.append(Paragraph(
        f"FocusGuard AI · Confidential focus report for {data['user_name']} "
        f"· Generated {data.get('generated_at_display') or ''}",
        small,
    ))

    doc.build(story)
    return buffer.getvalue()


class PDFReportView(generics.GenericAPIView):
    """GET /api/dashboard/report/pdf/?date=YYYY-MM-DD — download PDF focus report."""
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        date_str = request.query_params.get('date')
        if not date_str:
            target_date = timezone.localdate()
        else:
            try:
                target_date = datetime.strptime(date_str, '%Y-%m-%d').date()
            except ValueError:
                return Response({'error': 'Invalid date format, use YYYY-MM-DD'}, status=400)

        data = _build_report_data(request.user, target_date)
        pdf_bytes = _draw_pdf(data)
        filename = f"focusguard-report-{data['date']}.pdf"
        response = HttpResponse(pdf_bytes, content_type='application/pdf')
        response['Content-Disposition'] = f'attachment; filename="{filename}"'
        return response
