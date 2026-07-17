# Designing a Multimodal RAG Pipeline

## The Interview Question
> **"Your PDF contains tables, images, and text. After chunking, the relationships between them are lost. How will you design a RAG pipeline?"**

This question tests whether you understand that naive fixed-size chunking destroys document structure, and whether you know the architecture required to preserve it. The answer below is organized for delivery in an interview: name the core problem first, then walk through the five key stages.

---

## Core Problem
A PDF is not a stream of text—it is a layout. A table's meaning depends on its caption and the paragraph discussing it; a figure is referenced two paragraphs away. Split the document every 512 tokens and the caption lands in one chunk, the table in another, and retrieval returns fragments with no context. 

The fix is not better chunking parameters. It is **structure-aware parsing** plus **relationship-preserving indexing**.

---

## Stage 1 — Layout-Aware Parsing
Replace raw text extraction with a layout-aware parser (e.g., **Unstructured**, **Docling**, **LlamaParse**, or **Azure Document Intelligence**). 

These parsers return typed elements (such as `Title`, `NarrativeText`, `Table`, `Image`) along with bounding boxes, page numbers, and reading order:
* Tables are extracted as structured HTML or Markdown instead of mangled text.
* Images are isolated and extracted as separate assets.

---

## Stage 2 — Structure-Aware Chunking with Relational Metadata
Chunk along document boundaries (sections, headings) rather than fixed token counts. Then encode relationships explicitly in the metadata of each chunk:
* **Hierarchy**: Every chunk carries its section hierarchy (e.g., `Chapter 3 > Results`) and page number.
* **Explicit Links**: Links like `caption_of: table_7` or `referenced_by: chunk_42` connect related elements.
* **Captions**: A table is always kept together with its caption and, ideally, the sentence introducing it.
* **Contextual Retrieval (Anthropic's technique)**: Use an LLM to prepend a one-line description of where the chunk sits in the document context before embedding it.

---

## Stage 3 — Multi-Vector Indexing for Tables and Images
You cannot embed a raw table or image directly and expect good semantic retrieval. Instead, apply the **multi-vector / parent-document retriever pattern**:
1. **Summarize**: Generate a natural-language summary of each table and image using a vision-capable LLM.
2. **Embed**: Embed only the text summaries in the vector store.
3. **Store**: Store the raw elements (table Markdown, image bytes) in a separate document store, keyed by ID.

At query time, you retrieve based on the summary but hand the LLM the original element.

---

## Stage 4 — Retrieval and Generation
Use hybrid search (dense embeddings + BM25) with a cross-encoder reranker. 

When a summary chunk is retrieved:
1. Follow its ID back to the doc store.
2. Inject the raw element into the prompt (the table as Markdown, the image as raw bytes to a multimodal model).
3. Pull sibling context: if a table chunk is retrieved, its linked caption and surrounding paragraph are fetched via metadata links to restore context.

---

## Stage 5 — Evaluation
Measure retrieval quality (**recall@k**, **MRR**) and generation quality (**faithfulness**, **answer relevance** using frameworks like RAGAS or LLM-as-a-judge). 

Build a evaluation test set that specifically includes table-lookup and figure-interpretation questions, since those are where naive pipelines fail.

---

## Pipeline Summary

| Stage | What Happens | Tools & Patterns |
| :--- | :--- | :--- |
| **Parsing** | Typed elements with layout, reading order, and bounding boxes | Docling, LlamaParse, Azure DI, Unstructured |
| **Chunking** | Section-aware splits; captions stay with tables; relational metadata | Contextual retrieval, parent/child links |
| **Indexing** | Embed VLM summaries; store raw tables/images separately | Multi-vector retriever, vector store + doc store |
| **Retrieval** | Hybrid search, rerank, fetch raw parent + sibling context | Dense + BM25, cross-encoder reranker |
| **Generation** | Multimodal LLM answers with real tables and images in context | Claude 3.5 Sonnet, GPT-4o |
| **Evaluation** | Retrieval and faithfulness metrics on table/figure questions | Recall@k, MRR, RAGAS, LLM-as-judge |

---

## Common Interview Follow-Ups

### "Why not just embed the images directly?"
You can—joint embedding models like **CLIP** exist, and **ColPali** goes further by embedding page screenshots and skipping parsing entirely. ColPali is a strong alternative architecture. However, the summary-based multi-vector approach provides better text-query alignment and keeps everything in a single, standard text embedding space, which remains the default production choice.

### "What if the document is a spreadsheet instead?"
Different problem, different tool. Lookup questions can use row-level retrieval (serialize rows with headers), but analytical questions ("average Q3 revenue") cannot be answered from chunks—route them to text-to-SQL over an engine like **DuckDB**. 
* **Rule of thumb**: Rows are for retrieving, tables are for querying. Embed descriptions for routing; compute answers with a real query engine.

---

## Summary (One-Liner)
> **"I parse for structure, chunk by sections with relational metadata, index summaries while storing raw elements, retrieve hybrids and fetch the originals, and hand a multimodal LLM the real table and the real image — so nothing chunking destroyed is ever lost."**
