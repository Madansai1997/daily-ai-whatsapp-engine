import os
import sys
import asyncio

# Ensure parent directory is in sys.path
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from pdf_rag_agent import init_pdf_rag_tables, ingest_pdf

async def main():
    init_pdf_rag_tables()
    
    doc_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "docs", "multimodal_rag_pipeline.md")
    
    if not os.path.exists(doc_path):
        print(f"Error: File not found at {doc_path}")
        return
        
    with open(doc_path, "r", encoding="utf-8") as f:
        content = f.read()
        
    # Split pages on the Markdown horizontal rules (---)
    pages = [p.strip() for p in content.split("\n---") if p.strip()]
    
    if not pages:
        print("Error: No pages found in the document.")
        return
        
    print(f"Ingesting {len(pages)} pages into the PDF RAG index...")
    result = await ingest_pdf("multimodal_rag_pipeline.md", pages)
    print("✅ Ingestion successful!")
    print(f"Document Metadata: {result}")

if __name__ == "__main__":
    asyncio.run(main())
