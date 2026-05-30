import pytest
import json
import os
import asyncio
from anthropic import Anthropic
from V3_updates import generate_daily_payload, fetch_live_internet_updates

def run_async_task(coro):
    try:
        loop = asyncio.get_event_loop()
    except RuntimeError:
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
    return loop.run_until_complete(coro)

@pytest.fixture(scope="module")
def sample_payload_data():
    """Generates raw data and AI response synchronously."""
    raw_news = fetch_live_internet_updates()
    news_context = "\n\n".join([f"Title: {a['title']}\nSnippet: {a['content']}" for a in raw_news[:3]])
    
    planner_context = {
        "concept": "Pytest Assertion Optimization for LLM Outputs",
        "pedagogical_focus": "Master writing robust, non-flaky evaluation assertions using regex match logic.",
        "assert_template": "Test output string pattern requirements match strict schema specifications."
    }
    
    whatsapp_payload, reference_code = run_async_task(
        generate_daily_payload(
            raw_data=news_context,
            skill_level="Advanced",
            exclusions="None",
            planner_context=planner_context
        )
    )
    
    return {
        "context_source": news_context,
        "generated_payload": whatsapp_payload,
        "reference_code": reference_code
    }

def test_faithfulness_and_groundedness(sample_payload_data):
    """JUDGE METRIC 1: Evaluates if content hallucinates outside source context."""
    key = os.getenv("CLAUDE_API_KEY")
    if not key:
        pytest.skip("Skipping evaluation: CLAUDE_API_KEY not set.")
        
    judge_client = Anthropic(api_key=key)
    context = sample_payload_data["context_source"]
    payload = sample_payload_data["generated_payload"]
    
    judge_prompt = f"""
    You are an un-biased AI Quality Auditor. Evaluate the FAITHFULNESS of an AI response against source data.
    
    [CONTEXT SOURCE DATA]
    {context}
    
    [AI GENERATED RESPONSE]
    {payload}
    
    Does it introduce facts completely absent from Context Source Data?
    Respond in strict JSON format with keys: "score" (0.0 to 1.0) and "rationale".
    """
    
    response = judge_client.messages.create(
        model="claude-3-opus-20240229",  # Using the universal foundational identifier
        max_tokens=250,
        temperature=0.0,
        messages=[{"role": "user", "content": judge_prompt}]
    )
    
    result = json.loads(response.content[0].text.strip())
    print(f"\n⚖️ Faithfulness Evaluation Score: {result['score']}")
    print(f"📝 Rationale: {result['rationale']}")
    
    assert result["score"] >= 0.85

def test_answer_relevance(sample_payload_data):
    """JUDGE METRIC 2: Evaluates if output addresses curriculum focus rules."""
    key = os.getenv("CLAUDE_API_KEY")
    if not key:
        pytest.skip("Skipping evaluation: CLAUDE_API_KEY not set.")
        
    judge_client = Anthropic(api_key=key)
    payload = sample_payload_data["generated_payload"]
    
    judge_prompt = f"""
    Analyze the following AI-generated learning response.
    [AI GENERATED RESPONSE]
    {payload}
    
    Does it cover QA concepts like Pytest or validation loops, or contain excessive fluff?
    Respond in strict JSON format with keys: "score" (0.0 to 1.0) and "rationale".
    """
    
    response = judge_client.messages.create(
        model="claude-3-opus-20240229",
        max_tokens=250,
        temperature=0.0,
        messages=[{"role": "user", "content": judge_prompt}]
    )
    
    result = json.loads(response.content[0].text.strip())
    print(f"\n⚖️ Relevance Evaluation Score: {result['score']}")
    
    assert result["score"] >= 0.90

def test_formatting_compliance(sample_payload_data):
    """METRIC 3: Deterministic Structural Checklist."""
    payload = sample_payload_data["generated_payload"]
    
    assert "#" not in payload, "Formatting Defect: Markdown hashes leaked into payload."
    assert "*🔴 REGULAR DAILY AI UPDATES*" in payload
    assert "*📘 WHAT I NEED TO LEARN & PROJECTS TO WORK ON*" in payload
    print("\n⚖️ Formatting Compliance: PASSED")

# 🚀 Standalone Direct Run Script Logic
if __name__ == "__main__":
    print("🔄 Running evaluation pipeline directly...")
    if not os.getenv("CLAUDE_API_KEY"):
        print("❌ Error: CLAUDE_API_KEY environment variable is missing.")
    else:
        print("📦 Ingesting data payload...")
        data = sample_payload_data()
        
        print("⚖️ Running Faithfulness Judge...")
        test_faithfulness_and_groundedness(data)
        
        print("⚖️ Running Answer Relevance Judge...")
        test_answer_relevance(data)
        
        print("⚖️ Running Deterministic Formatting Checklist...")
        test_formatting_compliance(data)
        
        print("\n🎉 ALL LOCAL EVALUATION ASSET TESTS PASSED SUCCESSFULLY!")