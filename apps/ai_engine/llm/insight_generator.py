import json
import re
from django.utils import timezone
from django.db.models import Sum
from apps.browsing.models import BrowsingLog
from apps.ai_engine.models import AIInsight, ClassificationCache
from apps.ai_engine.rag.retriever import retrieve_relevant_context
from apps.ai_engine.llm.hf_client import query_huggingface, CLASSIFICATION_PROMPT_TEMPLATE


def classify_with_llm(identifier: str, item_type: str = "app", context: str = "") -> dict:
    """
    Hybrid classification fallback:
    Checks local DB cache first. If absent, queries Hugging Face LLM.
    """
    cached = ClassificationCache.objects.filter(identifier=identifier).first()
    if cached:
        return {
            "category": cached.category,
            "productivity_label": cached.productivity_label,
            "confidence_score": cached.confidence_score,
            "source": "cache"
        }

    # Query Hugging Face LLM
    prompt = CLASSIFICATION_PROMPT_TEMPLATE.format(
        item_type=item_type,
        identifier=identifier,
        context=context
    )
    llm_output = query_huggingface(prompt, max_tokens=150)

    category = "SYSTEM"
    tier = "NEUTRAL"
    confidence = 0.8

    if llm_output:
        try:
            match = re.search(r'\{.*?\}', llm_output, re.DOTALL)
            if match:
                data = json.loads(match.group(0))
                category = data.get("category", "SYSTEM")
                tier = data.get("productivity_label", "NEUTRAL")
                confidence = float(data.get("confidence_score", 0.85))
        except Exception:
            pass

    # Save to cache
    ClassificationCache.objects.create(
        identifier=identifier,
        item_type=item_type,
        category=category,
        productivity_label=tier,
        confidence_score=confidence
    )

    return {
        "category": category,
        "productivity_label": tier,
        "confidence_score": confidence,
        "source": "llm"
    }


def generate_attention_insight(user) -> AIInsight:
    """
    RAG + LLM pipeline:
    1. Aggregates today's desktop & browsing activity.
    2. Retrieves research knowledge chunks using ChromaDB.
    3. Builds structured prompt and queries Hugging Face LLM.
    4. Saves and returns AIInsight object.
    """
    today = timezone.now().date()

    # Browsing Logs from Chrome Extension
    browse_logs = BrowsingLog.objects.filter(user=user, visited_at__date=today)
    total_browse_secs = browse_logs.aggregate(s=Sum('time_spent_secs'))['s'] or 0
    prod_browse_secs = browse_logs.filter(productivity_label='PRODUCTIVE').aggregate(s=Sum('time_spent_secs'))['s'] or 0
    dist_browse_secs = browse_logs.filter(productivity_label='DISTRACTING').aggregate(s=Sum('time_spent_secs'))['s'] or 0

    # Desktop System App Logs from Desktop Agent
    from apps.system_monitor.models import SystemAppLog
    sys_logs = SystemAppLog.objects.filter(user=user, started_at__date=today)
    total_sys_secs = sys_logs.aggregate(s=Sum('duration_secs'))['s'] or 0
    prod_sys_secs = sys_logs.filter(productivity_label='PRODUCTIVE').aggregate(s=Sum('duration_secs'))['s'] or 0
    dist_sys_secs = sys_logs.filter(productivity_label='DISTRACTING').aggregate(s=Sum('duration_secs'))['s'] or 0

    total_secs = total_browse_secs + total_sys_secs
    total_prod = prod_browse_secs + prod_sys_secs
    total_dist = dist_browse_secs + dist_sys_secs

    # Scores
    neut_secs = max(0, total_secs - total_prod - total_dist)
    if total_secs > 0:
        if total_dist == 0:
            prod_score = 100.0
            dist_score = 0.0
        else:
            prod_score = round(min(100.0, ((total_prod + 0.5 * neut_secs) / total_secs) * 100), 1)
            dist_score = round((total_dist / total_secs * 100), 1)
    else:
        prod_score = 100.0
        dist_score = 0.0

    focus_score = max(20.0, min(100.0, prod_score))

    # Top Distracting Sites & Apps
    top_dist_sites = list(browse_logs.filter(productivity_label='DISTRACTING').values('domain').annotate(s=Sum('time_spent_secs')).order_by('-s')[:3])
    top_dist_apps = list(sys_logs.filter(productivity_label='DISTRACTING').values('app_name').annotate(s=Sum('duration_secs')).order_by('-s')[:3])

    distractors = []
    for s in top_dist_sites:
        distractors.append({"name": s['domain'], "duration_mins": round(s['s'] / 60, 1), "type": "site"})
    for a in top_dist_apps:
        distractors.append({"name": a['app_name'], "duration_mins": round(a['s'] / 60, 1), "type": "app"})

    total_pages = browse_logs.count()

    # Step 2: RAG Context Retrieval
    query = f"Digital distraction management and study focus with focus score {focus_score}"
    rag_chunks = retrieve_relevant_context(query, top_k=3)
    context_text = "\n\n".join([f"[{c['source']}] {c['content']}" for c in rag_chunks])

    # Step 3: LLM Inference
    prompt = f"""You are FocusGuard AI, an advanced cognitive attention and productivity intelligence agent.
Based on the following behavioral telemetry and psychological research context, generate personalized feedback.

=== TELEMETRY SUMMARY ===
- Overall Focus Score: {focus_score}/100
- Total Productive Screen Time: {round(total_prod / 60, 1)} minutes
- Total Distracted Screen Time: {round(total_dist / 60, 1)} minutes
- Web Pages Visited: {total_pages}
- Top Distractors: {json.dumps(distractors)}

=== SCIENTIFIC RESEARCH CONTEXT ===
{context_text}

=== INSTRUCTIONS ===
Provide:
1. An insightful paragraph (2-3 sentences) summarizing their attention leaks and focus state.
2. Three clear, bulleted recommendations to improve tomorrow's deep work.

Be direct, encouraging, and data-driven.
"""
    is_productive = (total_dist == 0) or (prod_score >= 55.0 and dist_score < 35.0)
    verdict_label = "PRODUCTIVE" if is_productive else "DISTRACTED"
    verdict_badge = "🟢 VERDICT: HIGHLY PRODUCTIVE" if is_productive else "🔴 VERDICT: ATTENTION LEAK & DISTRACTIONS DETECTED"

    llm_response = query_huggingface(prompt, max_tokens=350)

    if not llm_response:
        if is_productive:
            llm_response = (
                f"{verdict_badge}\n\n"
                f"You demonstrated strong focus today with a {prod_score}% productivity score. "
                f"You logged {round(total_prod / 60, 1)} minutes in productive engineering and research tools with minimal attention residue. "
                f"Your attention continuity is optimal for complex technical tasks."
            )
        else:
            dist_names = ", ".join([d['name'] for d in distractors]) if distractors else "non-work apps & websites"
            llm_response = (
                f"{verdict_badge}\n\n"
                f"Significant attention fragmentation was detected. "
                f"You spent {round(total_dist / 60, 1)} minutes on distracting activities ({dist_names}) compared to {round(total_prod / 60, 1)}m of productive output. "
                f"Distraction ratio reached {dist_score}%, causing context switching penalties."
            )
    else:
        llm_response = f"{verdict_badge}\n\n" + llm_response

    recommendations = [
        {"title": "Target High-Focus Morning Blocks", "detail": f"You visited {total_pages} web sessions today. Group research and study into focused batches."},
        {"title": "Shield Deep Work Intervals", "detail": "When studying on YouTube, avoid opening sidebar recommendations and shorts to prevent attention residue."},
        {"title": "Apply Pomodoro Recovery", "detail": "Take a structured 5-minute break away from screens between 25-minute study intervals."}
    ]

    insight = AIInsight.objects.create(
        user=user,
        date_analyzed=today,
        focus_score=focus_score,
        productivity_score=prod_score,
        distraction_score=dist_score,
        top_distractors=distractors,
        insights_text=llm_response,
        recommendations=recommendations,
        retrieved_chunks=rag_chunks
    )

    return insight
