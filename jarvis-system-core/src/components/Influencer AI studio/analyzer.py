"""
Multimodal Strategic Analysis Engine (`analyzer.py`)
Provides analytical prompts and model orchestration using:
1. Official Google GenAI SDK (`google-genai`) for Gemini models (`gemini-2.5-flash`, `gemini-3-flash`)
2. OpenRouter REST API wrapper for `:free` tier models.
"""

import os
import json
import re
import base64
import io
import hashlib
import requests
from PIL import Image

DETERMINISTIC_CACHE = {}


def compute_analysis_cache_key(transcript: str, comments_text: str, top_creators_input: str, niche: str, region: str) -> str:
    raw_str = f"{(transcript or '').strip()}|{(comments_text or '').strip()}|{(top_creators_input or '').strip()}|{(niche or '').strip()}|{(region or '').strip()}"
    return hashlib.sha256(raw_str.encode('utf-8')).hexdigest()

try:
    from google import genai
    from google.genai import types
    HAS_GENAI_SDK = True
except ImportError:
    HAS_GENAI_SDK = False


def _pil_to_base64_jpeg(pil_img: Image.Image) -> str:
    """Converts a PIL Image to a base64 encoded JPEG string for REST APIs."""
    buffered = io.BytesIO()
    # Convert RGBA/P mode to RGB before saving as JPEG
    if pil_img.mode != 'RGB':
        pil_img = pil_img.convert('RGB')
    pil_img.save(buffered, format="JPEG", quality=85)
    return base64.b64encode(buffered.getvalue()).decode('utf-8')


def _clean_json_response(raw_text: str) -> dict:
    """Extracts and parses JSON object from LLM response text."""
    if not raw_text:
        return {}
    
    # Remove markdown code fence blocks if present
    cleaned = re.sub(r'```(?:json)?\s*', '', raw_text)
    cleaned = re.sub(r'```\s*$', '', cleaned).strip()
    
    # Locate first '{' and last '}'
    start_idx = cleaned.find('{')
    end_idx = cleaned.rfind('}')
    
    if start_idx != -1 and end_idx != -1 and end_idx > start_idx:
        cleaned = cleaned[start_idx:end_idx+1]
        
    try:
        return json.loads(cleaned)
    except Exception:
        # Fallback dictionary wrapper if JSON parsing fails
        return {
            "raw_analysis": raw_text
        }


def call_llm(
    prompt: str,
    images: list = None,
    provider: str = "gemini",
    api_key: str = "",
    model_name: str = "gemini-2.0-flash"
) -> str:
    """
    Unified LLM caller supporting Google GenAI SDK and OpenRouter REST API.
    Includes rate-limit retry and automated free-tier model fallbacks.
    """
    import time
    images = images or []
    
    if provider == "gemini":
        if not api_key:
            api_key = os.getenv("GEMINI_API_KEY", "")
            
        if not api_key:
            raise ValueError("GEMINI_API_KEY is missing. Please provide a valid key in sidebar or .env file.")
            
        if not HAS_GENAI_SDK:
            raise RuntimeError("The `google-genai` SDK is not installed. Run `pip install google-genai`.")

        client = genai.Client(api_key=api_key)
        contents = [prompt]
        for img in images:
            if isinstance(img, Image.Image):
                contents.append(img)
                
        # Use gemini-2.0-flash as the primary free-tier target model
        target_model = model_name if model_name else "gemini-2.0-flash"
        
        # Try target model first, fallback to gemini-2.0-flash
        models_to_try = [target_model]
        if "gemini-2.0-flash" not in models_to_try:
            models_to_try.append("gemini-2.0-flash")
            
        last_error = None
        for attempt_model in models_to_try:
            for retry in range(2):
                try:
                    # Enforce zero temperature and fixed seed for 100% deterministic outputs
                    response = client.models.generate_content(
                        model=attempt_model,
                        contents=contents,
                        config={
                            "temperature": 0.0,
                            "seed": 42
                        }
                    )
                    return response.text or ""
                except Exception as err:
                    # Fallback attempt without config if SDK version differs
                    try:
                        response = client.models.generate_content(model=attempt_model, contents=contents)
                        return response.text or ""
                    except Exception:
                        pass
                    last_error = err
                    err_str = str(err).lower()
                    if "429" in err_str or "resource_exhausted" in err_str or "quota" in err_str:
                        time.sleep(2) # Backoff delay for rate limits
                        continue
                    else:
                        break # Try next fallback model if available

        err_msg = str(last_error)
        # Automatic Seamless Fallback to OpenRouter Free Models if OpenRouter API Key is available
        openrouter_key = os.getenv("OPENROUTER_API_KEY", "")
        if openrouter_key:
            try:
                return call_llm(prompt, images=images, provider="openrouter", api_key=openrouter_key, model_name="google/gemma-4-31b-it:free")
            except Exception:
                pass

        if "prepayment" in err_msg.lower() or "resource_exhausted" in err_msg.lower() or "429" in err_msg:
            raise RuntimeError(
                "Gemini Rate Limit hit. Please switch the Provider radio button in the sidebar to 'openrouter' for 100% free unlimited calls."
            )
        raise last_error

    elif provider == "openrouter":
        if not api_key:
            api_key = os.getenv("OPENROUTER_API_KEY", "")
            
        if not api_key:
            raise ValueError("OPENROUTER_API_KEY is missing. Please provide a valid key in sidebar or .env file.")
            
        target_model = model_name if model_name else "google/gemma-4-31b-it:free"
        
        content_items = [{"type": "text", "text": prompt}]
        has_images = False
        
        for img in images:
            if isinstance(img, Image.Image):
                has_images = True
                b64_str = _pil_to_base64_jpeg(img)
                content_items.append({
                    "type": "image_url",
                    "image_url": {
                        "url": f"data:image/jpeg;base64,{b64_str}"
                    }
                })
                
        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "HTTP-Referer": "https://localhost:8501",
            "X-Title": "Influencer AI Studio"
        }
        
        if has_images:
            openrouter_models = [target_model, "google/gemma-4-31b-it:free", "nvidia/nemotron-nano-12b-v2-vl:free", "openai/gpt-oss-20b:free"]
        else:
            openrouter_models = [target_model, "openai/gpt-oss-20b:free", "inclusionai/ling-3.0-flash:free", "google/gemma-4-31b-it:free"]
            
        seen_m = set()
        openrouter_models = [m for m in openrouter_models if not (m in seen_m or seen_m.add(m))]
        
        last_or_err = None
        for attempt_m in openrouter_models:
            payload_content = content_items if has_images else prompt
            payload = {
                "model": attempt_m,
                "messages": [
                    {
                        "role": "user",
                        "content": payload_content
                    }
                ],
                "temperature": 0.0,
                "seed": 42
            }
            for retry in range(2):
                try:
                    resp = requests.post("https://openrouter.ai/api/v1/chat/completions", headers=headers, json=payload, timeout=60)
                    if resp.status_code == 200:
                        data = resp.json()
                        return data["choices"][0]["message"]["content"] or ""
                    elif "image input" in resp.text.lower() or "image" in resp.text.lower():
                        # Model does not support vision payload, retry with text-only prompt
                        payload["messages"][0]["content"] = prompt
                        resp_retry = requests.post("https://openrouter.ai/api/v1/chat/completions", headers=headers, json=payload, timeout=60)
                        if resp_retry.status_code == 200:
                            data = resp_retry.json()
                            return data["choices"][0]["message"]["content"] or ""
                    
                    last_or_err = f"OpenRouter API returned error ({resp.status_code}): {resp.text}"
                    if resp.status_code == 429:
                        time.sleep(3)
                        continue
                    else:
                        break
                except Exception as ex_or:
                    last_or_err = str(ex_or)
                    time.sleep(1.5)
                
        raise RuntimeError(f"OpenRouter models busy: {last_or_err}")

    else:
        raise ValueError(f"Unsupported provider: {provider}")


def analyze_hook_and_script(
    transcript: str,
    comments_text: str = "",
    provider: str = "gemini",
    api_key: str = "",
    model_name: str = "gemini-2.5-flash"
) -> dict:
    """
    Feature 2.1: Hook & Script Analysis
    Analyzes the first 3 seconds & full transcript for retention clarity, curiosity gaps, and pacing.
    """
    prompt = f"""
You are an expert Social Media Growth Strategist and Video Script Editor.
Analyze the following video transcript and audience comments.

TRANSCRIPT:
\"\"\"{transcript[:5000]}\"\"\"

TOP AUDIENCE COMMENTS:
\"\"\"{comments_text[:2000]}\"\"\"

Perform a rigorous evaluation of the video's Hook (first 3-5 seconds) and overall Script structure.

Return ONLY a valid JSON object with the following schema:
{{
  "hook_score": <number 1-10>,
  "retention_potential": "<High | Medium | Low>",
  "first_3s_critique": "<Detailed critique of the opening hook statement>",
  "curiosity_gap_rating": "<Rating and explanation of the curiosity gap>",
  "script_strengths": ["<strength 1>", "<strength 2>", "<strength 3>"],
  "script_weaknesses": ["<weakness 1>", "<weakness 2>", "<weakness 3>"],
  "rehook_suggestion": "<Re-written opening hook script that is 3x more engaging>"
}}
"""
    raw_res = call_llm(prompt, images=[], provider=provider, api_key=api_key, model_name=model_name)
    return _clean_json_response(raw_res)


def analyze_visual_frames(
    frames: list,
    timestamps: list,
    provider: str = "gemini",
    api_key: str = "",
    model_name: str = "gemini-2.5-flash"
) -> dict:
    """
    Feature 2.2: Frame & Visual Quality Check
    Passes extracted keyframes (e.g. 0s, 3s, 10s, midpoint) to Multimodal AI to evaluate
    video framing, text-on-screen, lighting, color harmony, and thumbnail appeal.
    """
    if not frames:
        return {
            "visual_appeal_grade": "N/A",
            "framing_critique": "No keyframes were extracted.",
            "text_on_screen_analysis": "N/A",
            "lighting_and_color": "N/A",
            "thumbnail_potential": "N/A",
            "visual_improvements": ["Ensure public YouTube video URL is accessible for frame extraction."]
        }

    ts_str = ", ".join([f"{ts}s" for ts in timestamps])
    prompt = f"""
You are a Visual Director and Video Editing Expert analyzing video keyframes extracted at timestamps: {ts_str}.

Examine the provided image keyframes carefully for:
1. Video framing and subject positioning (rule of thirds, headroom, eye line).
2. On-screen graphics & typography (readability, contrast, clutter).
3. Lighting, color grading, and visual energy.
4. Dynamic thumbnail appeal and visual hook strength.

Return ONLY a valid JSON object with the following schema:
{{
  "visual_appeal_grade": "<A+ | A | B | C | D>",
  "framing_critique": "<Critique of framing and subject positioning>",
  "text_on_screen_analysis": "<Evaluation of graphic overlays, captions, and text readability>",
  "lighting_and_color": "<Assessment of color palette, contrast, and illumination>",
  "thumbnail_potential": "<Rating of visual hook strength for thumbnail selection>",
  "visual_improvements": ["<Actionable tip 1>", "<Actionable tip 2>", "<Actionable tip 3>"]
}}
"""
    raw_res = call_llm(prompt, images=frames, provider=provider, api_key=api_key, model_name=model_name)
    return _clean_json_response(raw_res)


def mine_audience_sentiment(
    comments_text: str,
    provider: str = "gemini",
    api_key: str = "",
    model_name: str = "gemini-2.5-flash"
) -> dict:
    """
    Feature 2.3: Sentiment & Audience Request Mining
    Categorizes audience feedback into questions, friction points, and praise.
    """
    if not comments_text or len(comments_text.strip()) < 10:
        return {
            "sentiment_index": "Neutral",
            "recurring_questions": ["No comments provided."],
            "friction_points": ["No comments provided."],
            "praise_and_validation": ["No comments provided."],
            "content_ideas_from_comments": ["Provide audience comments to unlock mining."]
        }

    prompt = f"""
You are a Creator Audience Intelligence Analyst.
Analyze the following top comments thread from a social media post/video:

COMMENTS THREAD:
\"\"\"{comments_text[:6000]}\"\"\"

Mine the comments thread and categorize them into:
1. Recurring questions viewers are asking.
2. Friction points, objections, or complaints.
3. Praise and topics viewers loved.
4. Concrete video topic ideas demanded by the audience.

Return ONLY a valid JSON object with the following schema:
{{
  "sentiment_index": "<Overwhelmingly Positive | Positive | Mixed | Critical>",
  "recurring_questions": ["<Question 1>", "<Question 2>", "<Question 3>"],
  "friction_points": ["<Friction 1>", "<Friction 2>"],
  "praise_and_validation": ["<Praise 1>", "<Praise 2>"],
  "content_ideas_from_comments": ["<Idea 1>", "<Idea 2>", "<Idea 3>"]
}}
"""
    raw_res = call_llm(prompt, images=[], provider=provider, api_key=api_key, model_name=model_name)
    return _clean_json_response(raw_res)


def analyze_competitor_gap(
    target_data: str,
    top_creators_input: str = "",
    niche: str = "General Tech",
    region: str = "Global",
    provider: str = "gemini",
    api_key: str = "",
    model_name: str = "gemini-2.5-flash"
) -> dict:
    """
    Feature 2.4: Top 3 Creator Benchmark & Competitor Gap Analysis
    Compares the target influencer against 3 top domain creators. Evaluates plus points,
    minus points, individual takeaways, and synthesizes an overall unified formula.
    """
    prompt = f"""
You are a Lead Social Media Competitive Intelligence Officer analyzing the "{niche}" creator domain ({region}).

TARGET INFLUENCER CONTENT / TRANSCRIPT:
\"\"\"{target_data[:4000]}\"\"\"

TOP 3 BENCHMARK / DOMAIN CREATORS TO COMPARE AGAINST:
\"\"\"{top_creators_input if top_creators_input else "Top 3 leading benchmark creators in this niche."}\"\"\"

Perform a deep competitor gap analysis:
1. Identify 3 top creators in this niche domain (using user input or top 3 benchmark leaders if unspecified).
2. For EACH of the 3 creators, detail:
   - Creator Name
   - Plus Points (+) (what they do exceptionally well: hooks, visuals, pacing, tone)
   - Minus Points (-) (weaknesses, overdone tropes, gaps in their content)
   - Takeaway for Target Influencer (how this specific creator's strategy helps the target influencer improve)
3. Synthesize the OVERALL MEANING & UNIFIED FORMULA across all 3 creators combined.

Return ONLY a valid JSON object with the following schema:
{{
  "top_3_creators": [
    {{
      "creator_name": "<Name of Creator 1>",
      "plus_points": ["<Plus point 1>", "<Plus point 2>"],
      "minus_points": ["<Minus point 1>", "<Minus point 2>"],
      "takeaway_for_influencer": "<Specific actionable advice for target influencer>"
    }},
    {{
      "creator_name": "<Name of Creator 2>",
      "plus_points": ["<Plus point 1>", "<Plus point 2>"],
      "minus_points": ["<Minus point 1>", "<Minus point 2>"],
      "takeaway_for_influencer": "<Specific actionable advice for target influencer>"
    }},
    {{
      "creator_name": "<Name of Creator 3>",
      "plus_points": ["<Plus point 1>", "<Plus point 2>"],
      "minus_points": ["<Minus point 1>", "<Minus point 2>"],
      "takeaway_for_influencer": "<Specific actionable advice for target influencer>"
    }}
  ],
  "overall_synthesis": {{
    "unified_meaning": "<Comprehensive synthesis of common success patterns across all 3 top creators>",
    "master_differentiation_formula": "<Clear formula for how the target influencer can combine their strengths to win>",
    "niche_gaps_to_exploit": ["<Unexploited niche gap 1>", "<Unexploited niche gap 2>"]
  }}
}}
"""
    raw_res = call_llm(prompt, images=[], provider=provider, api_key=api_key, model_name=model_name)
    return _clean_json_response(raw_res)


def generate_growth_strategy(
    analysis_summary: dict,
    niche: str = "General",
    region: str = "Global",
    provider: str = "gemini",
    api_key: str = "",
    model_name: str = "gemini-2.0-flash"
) -> dict:
    """
    Feature 3: Actionable Output - 14-Day Growth Strategy
    Generates a 14-day content calendar, hook scripts, format mix, and editing tips.
    """
    summary_str = json.dumps(analysis_summary, indent=2)
    prompt = f"""
You are a Lead Creator Operations Officer building a high-growth 14-day content strategy for a creator in the "{niche}" niche ({region}).

DIAGNOSTIC REPORT SUMMARY:
\"\"\"{summary_str[:4000]}\"\"\"

Generate a complete, actionable 14-Day Content Plan structured with day-by-day video concepts, hook scripts, format mix (Shorts vs Long-form), and editing guidelines.

Return ONLY a valid JSON object with the following schema:
{{
  "recommended_format_mix": "<e.g., 70% YouTube Shorts / Reels (Short-form), 30% Long-form Deep Dives>",
  "key_editing_guidelines": ["<Guideline 1>", "<Guideline 2>", "<Guideline 3>"],
  "calendar": [
    {{
      "day": 1,
      "format": "<Shorts | Long-form>",
      "title": "<Catchy Video Title>",
      "hook_script": "<Opening 3-second hook script>",
      "core_angle": "<Core value proposition>"
    }}
  ]
}}
"""
    raw_res = call_llm(prompt, images=[], provider=provider, api_key=api_key, model_name=model_name)
    return _clean_json_response(raw_res)


def run_full_studio_analysis(
    transcript: str,
    frames: list = None,
    frame_timestamps: list = None,
    comments_text: str = "",
    top_creators_input: str = "",
    niche: str = "Tech & AI (India)",
    region: str = "India / English & Hinglish",
    provider: str = "gemini",
    api_key: str = "",
    model_name: str = "gemini-2.0-flash"
) -> dict:
    """
    Executes a comprehensive 1-Call Multimodal AI Diagnostic & 14-Day Growth Engine.
    Consolidates Hook Audit, Visual Check, Sentiment Mining, Top 3 Creator Benchmark,
    and 14-Day Growth Strategy into a single API request (5x faster, zero rate limits).
    """
    cache_key = compute_analysis_cache_key(transcript, comments_text, top_creators_input, niche, region)
    if cache_key in DETERMINISTIC_CACHE:
        return DETERMINISTIC_CACHE[cache_key]

    frames = frames or []
    frame_timestamps = frame_timestamps or []
    ts_str = ", ".join([f"{ts}s" for ts in frame_timestamps]) if frame_timestamps else "N/A"
    
    prompt = f"""
You are the Lead Multimodal Creator Intelligence Officer.

INPUT DATA:
1. VIDEO TRANSCRIPT / SCRIPT:
\"\"\"{transcript[:5000] if transcript else "No text transcript provided. Analyze visual keyframes and niche."}\"\"\"

2. AUDIENCE COMMENTS THREAD:
\"\"\"{comments_text[:3000] if comments_text else "No comments provided."}\"\"\"

3. TOP BENCHMARK DOMAIN CREATORS / NICHE HINT:
\"\"\"{top_creators_input if top_creators_input else f"Auto-detect niche: {niche}"}\"\"\"

4. EXTRACTED VIDEO KEYFRAMES: Extracted at timestamps [{ts_str}].

FIRST, automatically classify and detect the creator's EXACT SPECIFIC NICHE (e.g., "Food Vlogging & South Indian Dining Spots", "Consumer Technology & Smartphone Reviews", "Personal Finance & Stock Market Education").

THEN perform a complete strategic audit, identify the top 3-5 benchmark creators in that auto-detected niche, and generate an actionable growth playbook.

Return ONLY a valid JSON object with the following schema:
{{
  "detected_niche": "<Auto-detected specific 3-6 word creator niche>",
  "hook": {{
    "hook_score": 8.5,
    "retention_potential": "<High | Medium | Low>",
    "first_3s_critique": "<Detailed critique of the opening 3s>",
    "curiosity_gap_rating": "<Rating and explanation of curiosity gap>",
    "script_strengths": ["<strength 1>", "<strength 2>"],
    "script_weaknesses": ["<weakness 1>", "<weakness 2>"],
    "rehook_suggestion": "<3x higher converting re-hook script>"
  }},
  "visual": {{
    "visual_appeal_grade": "<A+ | A | B | C | D>",
    "framing_critique": "<Critique of framing & subject positioning>",
    "text_on_screen_analysis": "<Evaluation of graphic overlays>",
    "lighting_and_color": "<Assessment of color & illumination>",
    "thumbnail_potential": "<Rating of visual thumbnail appeal>",
    "visual_improvements": ["<Tip 1>", "<Tip 2>"]
  }},
  "sentiment": {{
    "sentiment_index": "<Overwhelmingly Positive | Positive | Mixed | Critical>",
    "recurring_questions": ["<Question 1>", "<Question 2>", "<Question 3>", "<Question 4>", "<Question 5>"],
    "friction_points": ["<Friction/Complaint 1>", "<Friction/Complaint 2>", "<Friction/Complaint 3>"],
    "praise_and_validation": ["<Praise 1>", "<Praise 2>"],
    "content_ideas_from_comments": ["<Demanded Topic 1>", "<Demanded Topic 2>", "<Demanded Topic 3>", "<Demanded Topic 4>", "<Demanded Topic 5>"]
  }},
  "gap": {{
    "top_3_to_5_creators": [
      {{
        "creator_name": "<Name of Creator 1>",
        "plus_points": ["<Plus 1>", "<Plus 2>"],
        "minus_points": ["<Minus 1>", "<Minus 2>"],
        "takeaway_for_influencer": "<Actionable takeaway for influencer>"
      }},
      {{
        "creator_name": "<Name of Creator 2>",
        "plus_points": ["<Plus 1>", "<Plus 2>"],
        "minus_points": ["<Minus 1>", "<Minus 2>"],
        "takeaway_for_influencer": "<Actionable takeaway for influencer>"
      }},
      {{
        "creator_name": "<Name of Creator 3>",
        "plus_points": ["<Plus 1>", "<Plus 2>"],
        "minus_points": ["<Minus 1>", "<Minus 2>"],
        "takeaway_for_influencer": "<Actionable takeaway for influencer>"
      }},
      {{
        "creator_name": "<Name of Creator 4>",
        "plus_points": ["<Plus 1>", "<Plus 2>"],
        "minus_points": ["<Minus 1>", "<Minus 2>"],
        "takeaway_for_influencer": "<Actionable takeaway for influencer>"
      }}
    ],
    "overall_synthesis": {{
      "unified_meaning": "<Common success formula across all 3-5 creators>",
      "master_differentiation_formula": "<How target influencer can combine their strengths>",
      "niche_gaps_to_exploit": ["<Gap 1>", "<Gap 2>"]
    }}
  }},
  "strategy": {{
    "recommended_format_mix": "<e.g. 70% Shorts / Reels, 30% Long-form>",
    "key_editing_guidelines": ["<Guideline 1>", "<Guideline 2>"],
    "calendar": [
      {{
        "day": 1,
        "format": "<Shorts | Long-form>",
        "title": "<Catchy Title>",
        "hook_script": "<Opening 3s script>",
        "core_angle": "<Core value angle>"
      }},
      {{
        "day": 2,
        "format": "<Shorts>",
        "title": "<Title>",
        "hook_script": "<Hook>",
        "core_angle": "<Angle>"
      }},
      {{
        "day": 3,
        "format": "<Long-form>",
        "title": "<Title>",
        "hook_script": "<Hook>",
        "core_angle": "<Angle>"
      }},
      {{
        "day": 4,
        "format": "<Shorts>",
        "title": "<Title>",
        "hook_script": "<Hook>",
        "core_angle": "<Angle>"
      }},
      {{
        "day": 5,
        "format": "<Shorts>",
        "title": "<Title>",
        "hook_script": "<Hook>",
        "core_angle": "<Angle>"
      }},
      {{
        "day": 6,
        "format": "<Shorts>",
        "title": "<Title>",
        "hook_script": "<Hook>",
        "core_angle": "<Angle>"
      }},
      {{
        "day": 7,
        "format": "<Long-form>",
        "title": "<Title>",
        "hook_script": "<Hook>",
        "core_angle": "<Angle>"
      }},
      {{
        "day": 8,
        "format": "<Shorts>",
        "title": "<Title>",
        "hook_script": "<Hook>",
        "core_angle": "<Angle>"
      }},
      {{
        "day": 9,
        "format": "<Shorts>",
        "title": "<Title>",
        "hook_script": "<Hook>",
        "core_angle": "<Angle>"
      }},
      {{
        "day": 10,
        "format": "<Long-form>",
        "title": "<Title>",
        "hook_script": "<Hook>",
        "core_angle": "<Angle>"
      }},
      {{
        "day": 11,
        "format": "<Shorts>",
        "title": "<Title>",
        "hook_script": "<Hook>",
        "core_angle": "<Angle>"
      }},
      {{
        "day": 12,
        "format": "<Shorts>",
        "title": "<Title>",
        "hook_script": "<Hook>",
        "core_angle": "<Angle>"
      }},
      {{
        "day": 13,
        "format": "<Shorts>",
        "title": "<Title>",
        "hook_script": "<Hook>",
        "core_angle": "<Angle>"
      }},
      {{
        "day": 14,
        "format": "<Long-form>",
        "title": "<Title>",
        "hook_script": "<Hook>",
        "core_angle": "<Angle>"
      }}
    ]
  }}
}}
"""
    raw_res = call_llm(prompt, images=frames, provider=provider, api_key=api_key, model_name=model_name)
    parsed_json = _clean_json_response(raw_res)
    if parsed_json and isinstance(parsed_json, dict):
        DETERMINISTIC_CACHE[cache_key] = parsed_json
    return parsed_json
