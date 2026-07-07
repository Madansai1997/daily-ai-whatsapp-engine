"""
Study tracks — ordered curricula for the Daily AI Update.

When a track is active, the curriculum planner walks its concept list IN ORDER (skipping ones
already covered) instead of the LLM free-picking a random topic. This turns the daily digest into
a real, role-targeted syllabus. Selecting a track also sets the domain, so once the syllabus is
finished the free-choice planner still stays on-topic.
"""

_AI_ENGINEERING = [
    "Large language models: tokens, context windows and inference",
    "Prompt engineering patterns (few-shot, chain-of-thought, structured output)",
    "Embeddings and vector similarity search",
    "Retrieval-Augmented Generation (RAG) architecture",
    "Chunking strategies and retrieval quality for RAG",
    "Vector databases (FAISS, pgvector, Pinecone)",
    "Function calling and tool use",
    "AI agents and the reason-act (ReAct) loop",
    "Multi-agent orchestration and hand-offs",
    "Agent memory and state management",
    "LLM evaluation: offline evals and metrics",
    "LLM-as-a-judge and rubric grading",
    "Observability and tracing for LLM apps",
    "Guardrails, safety and prompt-injection defense",
    "Structured outputs and JSON-schema enforcement",
    "Caching, cost and latency optimization",
    "Streaming responses and token budgeting",
    "Fine-tuning vs RAG vs prompting tradeoffs",
    "Model routing and fallback strategies",
    "Deploying and serving LLM applications",
]

_ML_FOUNDATIONS = [
    "Supervised vs unsupervised vs reinforcement learning",
    "Train/validation/test splits and data leakage",
    "The bias-variance tradeoff",
    "Overfitting, underfitting and regularization",
    "Evaluation metrics: precision, recall, F1, ROC-AUC",
    "The confusion matrix and threshold tuning",
    "Feature engineering and feature scaling",
    "Linear and logistic regression",
    "Gradient descent and the learning rate",
    "Decision trees, random forests and gradient boosting",
    "Cross-validation",
    "Handling imbalanced datasets",
    "Clustering (k-means) and dimensionality reduction (PCA)",
    "Neural network basics: layers, activations, backprop",
    "Loss functions and optimization",
    "Embeddings and representation learning",
]


def _interleave(a, b):
    """Weave two syllabi together (a, b, a, b, …) so the combo track alternates foundations
    with applied AI engineering."""
    out, i, j = [], 0, 0
    while i < len(a) or j < len(b):
        if i < len(a):
            out.append(a[i]); i += 1
        if j < len(b):
            out.append(b[j]); j += 1
    return out


TRACKS = {
    "ai_engineering": {
        "name": "AI Engineering",
        "description": "Build production LLM & agentic systems — the hottest AI hiring lane, and the best fit for what you've already built.",
        "domain": "AI Engineering and applied LLM systems",
        "concepts": _AI_ENGINEERING,
    },
    "ml_foundations": {
        "name": "ML Foundations",
        "description": "The core machine-learning concepts you need to be credible in AI interviews.",
        "domain": "core machine learning fundamentals",
        "concepts": _ML_FOUNDATIONS,
    },
    "ai_engineer_combo": {
        "name": "AI Engineer (role-focused)",
        "description": "Interleaves ML foundations with AI engineering — your Data → AI combo path.",
        "domain": "AI engineering with machine-learning foundations",
        "concepts": _interleave(_ML_FOUNDATIONS, _AI_ENGINEERING),
    },
}


def next_concept(track_key: str, completed_lower: set):
    """Return (concept, track) — the first syllabus concept not yet covered, or (None, track)
    when the syllabus is complete, or (None, None) for an unknown track."""
    t = TRACKS.get(track_key)
    if not t:
        return None, None
    for c in t["concepts"]:
        if c.strip().lower() not in completed_lower:
            return c, t
    return None, t


def track_progress(track_key: str, completed_lower: set) -> dict:
    t = TRACKS.get(track_key)
    if not t:
        return None
    total = len(t["concepts"])
    done = sum(1 for c in t["concepts"] if c.strip().lower() in completed_lower)
    nxt, _ = next_concept(track_key, completed_lower)
    return {"key": track_key, "name": t["name"], "domain": t["domain"],
            "total": total, "completed": done, "next": nxt, "concepts": t["concepts"]}


def list_tracks() -> list:
    return [{"key": k, "name": v["name"], "description": v["description"],
             "total": len(v["concepts"])} for k, v in TRACKS.items()]
