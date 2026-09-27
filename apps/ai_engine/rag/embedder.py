from django.conf import settings

_embedder = None

def get_embedding_model():
    global _embedder
    if _embedder is None:
        from sentence_transformers import SentenceTransformer
        _embedder = SentenceTransformer(settings.HF_EMBEDDING_MODEL)
    return _embedder

def embed_text(text: str) -> list[float]:
    model = get_embedding_model()
    embeddings = model.encode(text)
    return embeddings.tolist()
