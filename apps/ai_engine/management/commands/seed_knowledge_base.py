from django.core.management.base import BaseCommand
from apps.ai_engine.rag.retriever import seed_knowledge_base

class Command(BaseCommand):
    help = 'Seeds attention and productivity research documents into ChromaDB'

    def handle(self, *args, **options):
        self.stdout.write("Seeding knowledge base into ChromaDB...")
        try:
            count = seed_knowledge_base()
            self.stdout.write(self.style.SUCCESS(f"Successfully indexed {count} knowledge documents!"))
        except Exception as e:
            self.stdout.write(self.style.ERROR(f"Error seeding knowledge base: {e}"))
