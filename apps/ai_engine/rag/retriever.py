import os
from .vector_store import get_knowledge_collection
from .embedder import embed_text


def seed_knowledge_base():
    """Reads all knowledge base text files and stores their vectors into ChromaDB."""
    collection = get_knowledge_collection()
    kb_dir = os.path.join(os.path.dirname(__file__), 'knowledge_base')

    if not os.path.exists(kb_dir):
        return 0

    count = 0
    for filename in os.listdir(kb_dir):
        if filename.endswith('.txt'):
            file_path = os.path.join(kb_dir, filename)
            with open(file_path, 'r', encoding='utf-8') as f:
                content = f.read().strip()
                if content:
                    doc_id = f"doc_{filename}"
                    embedding = embed_text(content)
                    collection.upsert(
                        ids=[doc_id],
                        documents=[content],
                        metadatas=[{"source": filename}],
                        embeddings=[embedding]
                    )
                    count += 1
    return count


def retrieve_relevant_context(query: str, top_k: int = 3) -> list[dict]:
    """Queries ChromaDB for semantically matching knowledge chunks."""
    try:
        collection = get_knowledge_collection()
        query_vec = embed_text(query)
        results = collection.query(
            query_embeddings=[query_vec],
            n_results=top_k,
            include=["documents", "metadatas", "distances"]
        )
        chunks = []
        if results and results.get("documents") and len(results["documents"]) > 0:
            for doc, meta, dist in zip(results["documents"][0], results["metadatas"][0], results["distances"][0]):
                chunks.append({
                    "content": doc,
                    "source": meta.get("source", "knowledge_base"),
                    "score": round(1.0 - dist, 3)
                })
        return chunks
    except Exception as e:
        print(f"[RAG Retriever Warning] {e}")
        return []
