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


_DATA_ANALYST = [
    "SQL Select, Where, and Group By fundamentals",
    "SQL Joins (Inner, Left, Right, Full Outer) explained with Venn diagrams",
    "SQL Window Functions (ROW_NUMBER, RANK, DENSE_RANK)",
    "Subqueries vs Common Table Expressions (CTEs)",
    "Pandas DataFrame basics: filtering, grouping, and merging",
    "Data cleaning: handling NULL values and duplicate removal",
    "Data visualization: picking the right chart for the story",
    "Statistical foundations: mean, median, mode, and standard deviation",
    "A/B testing and hypothesis testing basics",
    "Building interactive dashboards and KPI metrics",
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
        "name": "AI Engineering & LLM Magic 🚀",
        "description": "Build production LLM & agentic systems — explained simply with fun analogies and visual code snippets.",
        "domain": "AI Engineering and applied LLM systems",
        "concepts": _AI_ENGINEERING,
    },
    "data_analyst": {
        "name": "Data Science & SQL Superpowers 📊",
        "description": "Master SQL queries, Pandas, and data visualization like a pro data analyst.",
        "domain": "Data analytics, SQL queries, and data visualization",
        "concepts": _DATA_ANALYST,
    },
    "ml_foundations": {
        "name": "ML Foundations 🧠",
        "description": "The core machine-learning concepts made super simple for interviews.",
        "domain": "core machine learning fundamentals",
        "concepts": _ML_FOUNDATIONS,
    },
    "ai_engineer_combo": {
        "name": "Full Stack AI Mastery ⚡",
        "description": "Interleaves ML foundations with AI engineering — your complete Data → AI combo path.",
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


def add_dynamic_track(key: str, name: str, description: str, domain: str, concepts: list):
    """Add a dynamically generated learning track."""
    TRACKS[key] = {
        "name": name,
        "description": description,
        "domain": domain,
        "concepts": concepts
    }
    return TRACKS[key]


def get_curriculum_index(track_key: str) -> list:
    """Return structured topic index with task checklists for a track."""
    t = TRACKS.get(track_key, TRACKS["ai_engineering"])
    curriculum = []
    for idx, c in enumerate(t["concepts"]):
        curriculum.append({
            "id": f"topic_{idx + 1}",
            "index": idx + 1,
            "title": c,
            "tasks": [
                f"Task 1: Understand the core intuition of {c}",
                f"Task 2: Implement the hands-on code snippet for {c}",
                f"Task 3: Complete the mock quiz evaluation"
            ]
        })
    return curriculum


def list_tracks() -> list:
    return [{"key": k, "name": v["name"], "description": v["description"],
             "total": len(v["concepts"])} for k, v in TRACKS.items()]

