import requests
from django.conf import settings

CLASSIFICATION_PROMPT_TEMPLATE = """You are an expert AI categorizer for digital applications and websites.
Classify the following {item_type}: "{identifier}" (Context / Window Title: "{context}")
Choose EXACTLY ONE category from this list:
[PRODUCTIVE, DEVELOPMENT, EDUCATION, CREATIVE, COMMUNICATION, FINANCE, SYSTEM, NEWS_READING, ENTERTAINMENT, SOCIAL_MEDIA, GAMING, SHOPPING]

Choose EXACTLY ONE productivity tier from:
[PRODUCTIVE, NEUTRAL, DISTRACTING]

Output your response strictly in valid JSON format:
{{"category": "<CATEGORY>", "productivity_label": "<TIER>", "confidence_score": 0.9}}
"""


def query_huggingface(prompt: str, max_tokens: int = 512) -> str:
    """Queries Hugging Face Inference API or router."""
    api_key = settings.HF_API_KEY
    if not api_key or api_key == 'your_hugging_face_key_here':
        # Return fallback heuristic if user hasn't provided their key yet
        return ""

    model = settings.HF_LLM_MODEL
    url = f"https://api-inference.huggingface.co/models/{model}"
    headers = {"Authorization": f"Bearer {api_key}"}
    payload = {
        "inputs": prompt,
        "parameters": {
            "max_new_tokens": max_tokens,
            "temperature": 0.3,
            "return_full_text": False
        }
    }

    try:
        response = requests.post(url, headers=headers, json=payload, timeout=20)
        if response.status_code == 200:
            result = response.json()
            if isinstance(result, list) and len(result) > 0 and 'generated_text' in result[0]:
                return result[0]['generated_text']
            elif isinstance(result, dict) and 'generated_text' in result:
                return result['generated_text']
        else:
            print(f"[HuggingFace API Error] {response.status_code}: {response.text}")
    except Exception as e:
        print(f"[HuggingFace Request Exception] {e}")

    return ""
