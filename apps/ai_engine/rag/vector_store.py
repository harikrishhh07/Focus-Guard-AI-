import os
from django.conf import settings

def get_chroma_client():
    import chromadb
    os.makedirs(settings.CHROMA_PERSIST_DIR, exist_ok=True)
    return chromadb.PersistentClient(path=settings.CHROMA_PERSIST_DIR)

def get_knowledge_collection():
    client = get_chroma_client()
    return client.get_or_create_collection(name="productivity_knowledge_base")
