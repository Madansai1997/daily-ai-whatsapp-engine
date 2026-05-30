import re
import math
import collections
import aiosqlite
import os

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, "agent_memory.db")

# Standard search stopwords to filter out low-signal tokens
STOP_WORDS = {
    'a', 'about', 'above', 'after', 'again', 'against', 'all', 'am', 'an', 'and', 'any', 'are', 'arent', 'as', 'at',
    'be', 'because', 'been', 'before', 'being', 'below', 'between', 'both', 'but', 'by', 'can', 'cant', 'cannot',
    'could', 'couldnt', 'did', 'didnt', 'do', 'does', 'doesnt', 'doing', 'dont', 'down', 'during', 'each', 'few',
    'for', 'from', 'further', 'had', 'hadnt', 'has', 'hasnt', 'have', 'havent', 'having', 'he', 'hed', 'hell',
    'hes', 'her', 'here', 'heres', 'hers', 'herself', 'him', 'himself', 'his', 'how', 'hows', 'i', 'id', 'ill',
    'im', 'ive', 'if', 'in', 'into', 'is', 'isnt', 'it', 'its', 'itself', 'lets', 'me', 'more', 'most', 'mustnt',
    'my', 'myself', 'no', 'nor', 'not', 'of', 'off', 'on', 'once', 'only', 'or', 'other', 'ought', 'our', 'ours',
    'ourselves', 'out', 'over', 'own', 'same', 'shant', 'she', 'shed', 'shell', 'shes', 'should', 'shouldnt', 'so',
    'some', 'such', 'than', 'that', 'thats', 'the', 'their', 'theirs', 'them', 'themselves', 'then', 'there',
    'theres', 'these', 'they', 'theyd', 'theyll', 'theyre', 'theyve', 'this', 'those', 'through', 'to', 'too',
    'under', 'until', 'up', 'very', 'was', 'wasnt', 'we', 'wed', 'well', 'were', 'weve', 'werent', 'what',
    'whats', 'when', 'whens', 'where', 'wheres', 'which', 'while', 'who', 'whos', 'whom', 'why', 'whys', 'with',
    'wont', 'would', 'wouldnt', 'you', 'youd', 'youll', 'youre', 'youve', 'your', 'yours', 'yourself', 'yourselves'
}

def tokenize(text: str) -> list[str]:
    if not text:
        return []
    # Lowercase and extract alphanumeric words
    words = re.findall(r'\b\w+\b', text.lower())
    # Filter stopwords and numeric strings
    return [w for w in words if w not in STOP_WORDS and not w.isdigit()]

def compute_bm25(query_tokens: list[str], documents: list[dict], k1: float = 1.5, b: float = 0.75) -> list[tuple[dict, float]]:
    """Ranks documents using the standard BM25 algorithm."""
    if not documents or not query_tokens:
        return [(doc, 0.0) for doc in documents]
        
    N = len(documents)
    
    # Preprocess documents (tokenize & track lengths)
    doc_tokens = []
    doc_lens = []
    for doc in documents:
        tokens = tokenize(doc.get('title', '') + " " + doc.get('content', ''))
        doc_tokens.append(tokens)
        doc_lens.append(len(tokens))
        
    avg_doc_len = sum(doc_lens) / N if N > 0 else 1.0
    if avg_doc_len == 0:
        avg_doc_len = 1.0
        
    # Track document frequency for query terms
    df = collections.defaultdict(int)
    for tokens in doc_tokens:
        unique_tokens = set(tokens)
        for term in query_tokens:
            if term in unique_tokens:
                df[term] += 1
                
    # Compute inverse document frequency (IDF) with smoothing
    idf = {}
    for term in query_tokens:
        n_q = df[term]
        idf[term] = math.log(1 + (N - n_q + 0.5) / (n_q + 0.5))
        
    # Score documents
    scored_docs = []
    for i, doc in enumerate(documents):
        tokens = doc_tokens[i]
        doc_len = doc_lens[i]
        tf_counter = collections.Counter(tokens)
        
        score = 0.0
        for term in query_tokens:
            tf = tf_counter[term]
            if tf > 0:
                numerator = idf[term] * tf * (k1 + 1)
                denominator = tf + k1 * (1 - b + b * (doc_len / avg_doc_len))
                score += numerator / denominator
                
        scored_docs.append((doc, score))
        
    # Sort docs by relevance score descending
    scored_docs.sort(key=lambda x: x[1], reverse=True)
    return scored_docs

async def retrieve_relevant_context(query: str, limit: int = 3) -> list[dict]:
    """Fetches documents from SQLite and ranks them using BM25 relevance to the query."""
    query_tokens = tokenize(query)
    if not query_tokens:
        return []
        
    documents = []
    try:
        async with aiosqlite.connect(DB_PATH) as db:
            async with db.execute("SELECT url, title, content FROM knowledge_store ORDER BY timestamp DESC LIMIT 50") as cursor:
                rows = await cursor.fetchall()
                for row in rows:
                    documents.append({
                        "url": row[0],
                        "title": row[1],
                        "content": row[2]
                    })
    except Exception as e:
        print(f"⚠️ RAG Engine: Error querying knowledge store database: {e}")
        return []
        
    if not documents:
        return []
        
    ranked_docs = compute_bm25(query_tokens, documents)
    # Return documents that have a relevance score greater than 0
    matched_docs = [doc for doc, score in ranked_docs if score > 0]
    
    return matched_docs[:limit]
