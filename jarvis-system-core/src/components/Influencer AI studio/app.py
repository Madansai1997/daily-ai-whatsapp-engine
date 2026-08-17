"""
Influencer AI Studio (`app.py`)
Streamlit Dashboard for Multimodal Social Media Creator Analytics & Growth Strategy.
"""

import os
import streamlit as st
from PIL import Image
from dotenv import load_dotenv

# Import local modules
from ingestion import (
    extract_youtube_id,
    fetch_youtube_transcript,
    download_video_and_extract_frames,
    extract_instagram_code,
    download_instagram_and_extract_frames,
    fetch_creator_profile_content,
    extract_profile_handle
)
from analyzer import (
    analyze_hook_and_script,
    analyze_visual_frames,
    mine_audience_sentiment,
    analyze_competitor_gap,
    generate_growth_strategy,
    run_full_studio_analysis,
    call_llm
)

# Load environment variables
load_dotenv()
load_dotenv(".env.example")

# Page Configuration
st.set_page_config(
    page_title="Influencer AI Studio | Multimodal Creator Intelligence",
    page_icon="⚡",
    layout="wide",
    initial_sidebar_state="expanded"
)

# Dark Mode Custom Styling
st.markdown("""
<style>
    /* Dark theme customizations */
    .stApp {
        background-color: #0e1117;
        color: #e0e6ed;
    }
    .main-header {
        font-size: 2.2rem;
        font-weight: 800;
        background: linear-gradient(90deg, #7928CA, #FF0080);
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
        margin-bottom: 0.2rem;
    }
    .sub-header {
        font-size: 1.0rem;
        color: #9aa5b1;
        margin-bottom: 1.5rem;
    }
    .metric-card {
        background-color: #1a1f2c;
        border: 1px solid #2d3748;
        border-radius: 10px;
        padding: 1.2rem;
        text-align: center;
        box-shadow: 0 4px 6px rgba(0, 0, 0, 0.3);
    }
    .metric-value {
        font-size: 2.0rem;
        font-weight: 700;
        color: #00f2fe;
    }
    .metric-label {
        font-size: 0.85rem;
        color: #a0aec0;
        text-transform: uppercase;
        letter-spacing: 0.05em;
    }
    .card-box {
        background-color: #161b26;
        border: 1px solid #283143;
        border-radius: 12px;
        padding: 1.5rem;
        margin-bottom: 1rem;
    }
    .badge-shorts {
        background-color: #e53e3e;
        color: white;
        padding: 3px 10px;
        border-radius: 12px;
        font-size: 0.8rem;
        font-weight: 600;
    }
    .badge-long {
        background-color: #3182ce;
        color: white;
        padding: 3px 10px;
        border-radius: 12px;
        font-size: 0.8rem;
        font-weight: 600;
    }
    div[data-testid="stSidebar"] {
        background-color: #111622;
        border-right: 1px solid #212936;
    }
</style>
""", unsafe_allow_html=True)

# Initialize Session State Variables
if "transcript" not in st.session_state:
    st.session_state.transcript = ""
if "extracted_frames" not in st.session_state:
    st.session_state.extracted_frames = []
if "frame_timestamps" not in st.session_state:
    st.session_state.frame_timestamps = []
if "analysis_results" not in st.session_state:
    st.session_state.analysis_results = None
if "growth_strategy" not in st.session_state:
    st.session_state.growth_strategy = None


# --- SIDEBAR CONFIGURATION ---
with st.sidebar:
    st.image("https://img.icons8.com/isometric/96/000000/flash-on.png", width=64)
    st.title("Studio Settings")
    
    st.markdown("### 🔑 API Provider & Keys")
    provider = st.radio(
        "Choose AI Engine Provider:",
        ["gemini", "openrouter"],
        captions=["Google GenAI Free Tier", "OpenRouter Free Models"]
    )
    
    default_gemini_key = os.getenv("GEMINI_API_KEY", "")
    default_openrouter_key = os.getenv("OPENROUTER_API_KEY", "")
    
    if provider == "gemini":
        gemini_api_key = st.text_input(
            "Gemini API Key:",
            value=default_gemini_key,
            type="password",
            help="Get your free key at https://aistudio.google.com/"
        )
        api_key = gemini_api_key
        model_name = st.selectbox(
            "Model Target:",
            ["gemini-2.0-flash", "gemini-2.5-flash", "gemini-3-flash"],
            help="gemini-2.0-flash is the 100% free tier model on Google AI Studio"
        )
    else:
        openrouter_api_key = st.text_input(
            "OpenRouter API Key:",
            value=default_openrouter_key,
            type="password",
            help="Get a free key at https://openrouter.ai/"
        )
        api_key = openrouter_api_key
        model_name = st.selectbox(
            "OpenRouter Model:",
            [
                "openai/gpt-oss-20b:free",
                "inclusionai/ling-3.0-flash:free",
                "google/gemma-4-31b-it:free"
            ],
            help="Active 100% free models on OpenRouter with auto-failover"
        )
        
    st.divider()
    st.markdown("### 🎯 Niche & Audience Context")
    niche = st.text_input(
        "Creator Niche / Domain (Auto-Detected by AI):",
        value="🤖 Auto-Detect Niche (AI Classification)",
        help="AI automatically classifies your exact creator niche from video transcripts, captions, and comments!"
    )
        
    region = st.text_input(
        "Target Region / Language:",
        value="India / English & Hinglish",
        help="Target geographic region or audience language preference"
    )

    st.markdown("---")
    st.caption("⚡ $0 Budget Multimodal AI Creator Studio")


# --- MAIN HEADER ---
st.markdown('<div class="main-header">⚡ Influencer AI Studio</div>', unsafe_allow_html=True)
st.markdown('<div class="sub-header">Free Multimodal Social Media Creator Intelligence, Hook Auditing & 14-Day Growth Engine</div>', unsafe_allow_html=True)


# --- TAB NAVIGATION ---
tab_input, tab_report, tab_strategy = st.tabs([
    "📥 1. Input Content",
    "📊 2. Diagnostic Report",
    "🚀 3. 14-Day Growth Strategy"
])


# ==========================================
# TAB 1: INPUT CONTENT
# ==========================================
with tab_input:
    st.markdown("### Extract Content & Audience Data")
    
    platform_choice = st.radio(
        "Choose Ingestion Mode:",
        ["👤 Creator Profile ID / Channel Handle", "🎥 Single YouTube Video / Shorts", "📸 Single Instagram Reel / Post"],
        horizontal=True
    )
    
    if "Creator Profile ID" in platform_choice:
        profile_platform = st.radio(
            "Select Profile Platform:",
            ["📸 Instagram Profile (@handle)", "🎥 YouTube Channel (@handle)"],
            horizontal=True
        )
        col_pr1, col_pr2 = st.columns([3, 1])
        with col_pr1:
            profile_input = st.text_input(
                "Creator Profile Handle or Link:",
                placeholder="@thatindiefoodie, @techburner, or https://www.instagram.com/thatindiefoodie",
                help="Enter any Instagram profile handle (@handle) or YouTube Channel handle"
            )
        with col_pr2:
            num_videos = st.number_input("Posts/Videos to Scrape", min_value=1, max_value=10, value=5)
            
        if st.button("🔍 Ingest & Scrape Creator Profile (Recent Reels/Videos + Comments)", type="primary", use_container_width=True):
            if not profile_input:
                st.error("Please enter a valid Creator Profile Handle or Link.")
            else:
                chosen_platform = "instagram" if "Instagram" in profile_platform or "instagram.com" in profile_input or "instagr.am" in profile_input else "youtube"
                with st.spinner(f"🤖 Ingesting {chosen_platform.upper()} profile {profile_input}, scraping {num_videos} recent posts & mining comments..."):
                    p_res = fetch_creator_profile_content(profile_input, platform=chosen_platform, video_limit=num_videos)
                    if p_res["success"]:
                        st.session_state.transcript = p_res["transcript"]
                        st.session_state.comments_text = p_res["comments_text"]
                        st.session_state.extracted_frames = p_res["extracted_frames"]
                        st.session_state.frame_timestamps = p_res["frame_timestamps"]
                        v_count = len(p_res.get("videos_analyzed", []))
                        st.success(f"✅ Successfully ingested {chosen_platform.title()} profile {p_res['profile_handle']}! Analyzed {v_count} recent posts/reels and aggregated viewer engagement.")
                    else:
                        st.error(f"Failed to ingest profile: {p_res['error']}")

    elif "YouTube" in platform_choice:
        col_yt1, col_yt2 = st.columns([3, 1])
        with col_yt1:
            yt_url = st.text_input(
                "YouTube Video or Shorts URL:",
                placeholder="https://www.youtube.com/watch?v=... or https://youtube.com/shorts/..."
            )
        with col_yt2:
            extract_frames_check = st.checkbox("Extract Keyframes", value=True, help="Downloads video to sample frames at 0s, 3s, 10s & midpoint via OpenCV")

        if st.button("🔍 Ingest YouTube Video", type="primary", use_container_width=True):
            if not yt_url:
                st.error("Please enter a valid YouTube Video or Shorts URL.")
            elif "instagram.com" in yt_url or "instagr.am" in yt_url:
                # Smart Auto-routing for Instagram URLs pasted in YouTube box
                with st.spinner("🤖 Auto-detected Instagram Reel URL! Running 100% automated Instagram extraction..."):
                    ig_result = download_instagram_and_extract_frames(yt_url, timestamps_sec=[0.0, 3.0, 10.0])
                    if ig_result["success"]:
                        st.session_state.extracted_frames = ig_result["frames"]
                        st.session_state.frame_timestamps = ig_result["frame_timestamps"]
                        if ig_result.get("transcript"):
                            st.session_state.transcript = ig_result["transcript"]
                            st.success(f"✅ Automatically extracted Instagram Reel caption ({len(ig_result['transcript'])} chars) & keyframe(s)!")
                        else:
                            st.success(f"✅ Successfully extracted {len(ig_result['frames'])} Reel keyframe(s)!")
                    else:
                        st.warning(f"⚠️ Instagram extraction note: {ig_result['error']}")
            else:
                with st.spinner("Extracting YouTube Transcript..."):
                    t_result = fetch_youtube_transcript(yt_url)
                    if t_result["success"]:
                        st.session_state.transcript = t_result["transcript"]
                        st.success(f"✅ Successfully fetched transcript ({len(t_result['transcript'])} characters).")
                    else:
                        st.warning(f"⚠️ Transcript note: {t_result['error']}. You can paste transcript manually below.")
                        
                if extract_frames_check:
                    with st.spinner("Downloading video & sampling keyframes at [0s, 3s, 10s, midpoint] using OpenCV..."):
                        f_result = download_video_and_extract_frames(yt_url, timestamps_sec=[0.0, 3.0, 10.0])
                        if f_result["success"]:
                            st.session_state.extracted_frames = f_result["frames"]
                            st.session_state.frame_timestamps = f_result["frame_timestamps"]
                            st.success(f"✅ Successfully extracted {len(f_result['frames'])} video keyframes!")
                        else:
                            st.warning(f"⚠️ Frame extraction note: {f_result['error']}")

    else:
        # Instagram Ingestion Mode
        col_ig1, col_ig2 = st.columns([3, 1])
        with col_ig1:
            ig_url = st.text_input(
                "Instagram Reel or Post URL:",
                placeholder="https://www.instagram.com/reel/C8xYz12345/ or https://www.instagram.com/p/..."
            )
        with col_ig2:
            st.markdown("<br>", unsafe_allow_html=True)
            st.caption("Auto Keyframe + Gemini Vision Transcription")

        if st.button("📸 Ingest Instagram Reel & Keyframes", type="primary", use_container_width=True):
            if not ig_url:
                st.error("Please enter a valid public Instagram Reel or Post URL.")
            else:
                with st.spinner("Automating Instagram Reel extraction & keyframe sampling..."):
                    ig_result = download_instagram_and_extract_frames(ig_url, timestamps_sec=[0.0, 3.0, 10.0])
                    if ig_result["success"]:
                        st.session_state.extracted_frames = ig_result["frames"]
                        st.session_state.frame_timestamps = ig_result["frame_timestamps"]
                        
                        if ig_result.get("transcript"):
                            st.session_state.transcript = ig_result["transcript"]
                            st.success(f"✅ Automatically extracted Reel caption text ({len(ig_result['transcript'])} chars) & keyframe(s)!")
                        else:
                            st.success(f"✅ Successfully extracted {len(ig_result['frames'])} Reel keyframe(s)!")
                        
                        # Generate visual transcript summary via Gemini Multimodal Vision if transcript was empty
                        if api_key and not st.session_state.transcript and ig_result["frames"]:
                            with st.spinner("🤖 Multimodal AI transcribing Reel visuals & text-on-screen..."):
                                try:
                                    vis_prompt = "Examine these video keyframes from this Instagram Reel. Transcribe all text-on-screen, captions, audio topics, and narrative flow into a clean video transcript summary."
                                    synth_transcript = call_llm(vis_prompt, images=ig_result["frames"], provider=provider, api_key=api_key, model_name=model_name)
                                    if synth_transcript:
                                        st.session_state.transcript = synth_transcript
                                        st.success("✅ Synthesized video transcript from Reel keyframes!")
                                except Exception as ex:
                                    st.warning(f"Note on Reel transcript synthesis: {ex}")
                    else:
                        st.warning(f"⚠️ Instagram note: {ig_result['error']}")

    st.divider()
    st.markdown("### 🖼️ Keyframe Screenshots & Aggregated Comments")
    st.caption("Review extracted/uploaded keyframes, video scripts, and aggregated audience comments across profile videos.")

    uploaded_files = st.file_uploader(
        "Upload Video Screenshot / Keyframe Images (Optional):",
        type=["png", "jpg", "jpeg", "webp"],
        accept_multiple_files=True,
        help="Upload screenshots from Instagram Reels/TikTok/YouTube to run multimodal AI visual analysis"
    )
    if uploaded_files:
        imgs = []
        timestamps = []
        for idx, file in enumerate(uploaded_files):
            try:
                img = Image.open(file)
                imgs.append(img)
                timestamps.append(float(idx * 3))
            except Exception:
                pass
        if imgs:
            st.session_state.extracted_frames = imgs
            st.session_state.frame_timestamps = timestamps
            st.success(f"✅ Successfully loaded {len(imgs)} uploaded image keyframe(s) for Multimodal AI analysis!")

    col_m1, col_m2 = st.columns(2)
    with col_m1:
        manual_transcript = st.text_area(
            "Aggregated Video Transcripts / Script / Caption:",
            value=st.session_state.transcript,
            height=220,
            placeholder="Paste or review raw transcript, script, or profile video text here..."
        )
        st.session_state.transcript = manual_transcript

    with col_m2:
        comments_text = st.text_area(
            "Aggregated Audience Comments Thread (Profile-Wide):",
            value=st.session_state.comments_text if "comments_text" in st.session_state else "",
            height=220,
            placeholder="Paste or review top viewer comments mined across profile videos here..."
        )

    default_top3_text = f"Discover top 3-5 creators in domain: {niche}"

    top_creators_input = st.text_area(
        "Top 3–5 Benchmark Creators in your Domain (Leave as-is for auto-discovery):",
        value=f"Top 3 to 5 leading creators in {niche}",
        height=70,
        help="AI will automatically discover and benchmark the top 3-5 content creators in your specified niche."
    )

    st.markdown("<br>", unsafe_allow_html=True)
    
    if st.button("🚀 Run Full Multimodal AI Analysis", type="primary", use_container_width=True):
        if not api_key:
            st.error("Please enter a valid API Key in the left sidebar.")
        elif not st.session_state.transcript and not st.session_state.extracted_frames and not comments_text:
            st.error("Please provide at least a transcript, video frames, or comments thread to analyze.")
        else:
            with st.spinner("🤖 Running Multimodal AI Strategic Diagnostic (1-Call High Speed Engine)..."):
                try:
                    full_res = run_full_studio_analysis(
                        transcript=st.session_state.transcript,
                        frames=st.session_state.extracted_frames,
                        frame_timestamps=st.session_state.frame_timestamps,
                        comments_text=comments_text,
                        top_creators_input=top_creators_input,
                        niche=niche,
                        region=region,
                        provider=provider,
                        api_key=api_key,
                        model_name=model_name
                    )
                    
                    st.session_state.analysis_results = {
                        "hook": full_res.get("hook", {}),
                        "visual": full_res.get("visual", {}),
                        "sentiment": full_res.get("sentiment", {}),
                        "gap": full_res.get("gap", {})
                    }
                    st.session_state.growth_strategy = full_res.get("strategy", {})
                    
                    st.success("🎉 Analysis complete! Switch to the **Diagnostic Report** or **14-Day Growth Strategy** tabs to view your results.")
                    
                except Exception as ex:
                    st.error(f"Analysis failed: {str(ex)}")


# ==========================================
# TAB 2: DIAGNOSTIC REPORT
# ==========================================
with tab_report:
    if not st.session_state.analysis_results or st.session_state.analysis_results.get("hook", {}).get("hook_score") in [None, "N/A"]:
        st.info("💡 **Diagnostic Report Ready for Analysis**")
        st.markdown("""
        Content or profile data has been loaded into Tab 1. Click the button below to execute the 1-Call Multimodal AI Engine and generate your report!
        """)
        if st.button("🚀 Run Multimodal AI Strategic Diagnostic Now", type="primary", use_container_width=True):
            if not api_key:
                st.error("Please enter a valid API Key in the left sidebar.")
            elif not st.session_state.transcript and not st.session_state.extracted_frames and not st.session_state.get("comments_text"):
                st.error("Please provide at least a profile transcript, video frames, or comments thread in Tab 1 to analyze.")
            else:
                with st.spinner("🤖 Running Multimodal AI Strategic Diagnostic (1-Call High Speed Engine)..."):
                    try:
                        full_res = run_full_studio_analysis(
                            transcript=st.session_state.transcript,
                            frames=st.session_state.extracted_frames,
                            frame_timestamps=st.session_state.frame_timestamps,
                            comments_text=st.session_state.get("comments_text", ""),
                            top_creators_input=f"Top 3 to 5 leading creators in {niche}",
                            niche=niche,
                            region=region,
                            provider=provider,
                            api_key=api_key,
                            model_name=model_name
                        )
                        st.session_state.analysis_results = {
                            "hook": full_res.get("hook", {}),
                            "visual": full_res.get("visual", {}),
                            "sentiment": full_res.get("sentiment", {}),
                            "gap": full_res.get("gap", {})
                        }
                        st.session_state.growth_strategy = full_res.get("strategy", {})
                        st.success("🎉 Analysis complete! Report generated below.")
                        st.rerun()
                    except Exception as ex:
                        st.error(f"Analysis failed: {str(ex)}")

    if st.session_state.analysis_results and st.session_state.analysis_results.get("hook", {}).get("hook_score") not in [None, "N/A"]:
        results = st.session_state.analysis_results
        hook = results.get("hook", {})
        visual = results.get("visual", {})
        sentiment = results.get("sentiment", {})
        gap = results.get("gap", {})
        
        det_niche = results.get("detected_niche") or niche
        if det_niche:
            st.success(f"🎯 **Auto-Detected Creator Niche:** `{det_niche}`")
        
        # --- KPI Summary Bar ---
        col_kpi1, col_kpi2, col_kpi3, col_kpi4 = st.columns(4)
        
        with col_kpi1:
            h_score = hook.get("hook_score", "N/A")
            st.markdown(f"""
            <div class="metric-card">
                <div class="metric-value">{h_score}/10</div>
                <div class="metric-label">Opening Hook Score</div>
            </div>
            """, unsafe_allow_html=True)

        with col_kpi2:
            ret = hook.get("retention_potential", "N/A")
            st.markdown(f"""
            <div class="metric-card">
                <div class="metric-value">{ret}</div>
                <div class="metric-label">Retention Potential</div>
            </div>
            """, unsafe_allow_html=True)

        with col_kpi3:
            vis_grade = visual.get("visual_appeal_grade", "N/A")
            st.markdown(f"""
            <div class="metric-card">
                <div class="metric-value">{vis_grade}</div>
                <div class="metric-label">Visual Appeal Grade</div>
            </div>
            """, unsafe_allow_html=True)

        with col_kpi4:
            s_index = sentiment.get("sentiment_index", "N/A")
            st.markdown(f"""
            <div class="metric-card">
                <div class="metric-value">{s_index}</div>
                <div class="metric-label">Audience Sentiment</div>
            </div>
            """, unsafe_allow_html=True)

        st.markdown("<br>", unsafe_allow_html=True)

        # --- Section 1: Hook & Script Breakdown ---
        with st.container():
            st.markdown("### 🎣 Hook & Script Retention Breakdown")
            col_s1, col_s2 = st.columns(2)
            
            with col_s1:
                st.markdown("<div class='card-box'>", unsafe_allow_html=True)
                st.markdown("**First 3 Seconds Critique:**")
                st.write(hook.get("first_3s_critique", "N/A"))
                
                st.markdown("**Curiosity Gap Rating:**")
                st.write(hook.get("curiosity_gap_rating", "N/A"))
                
                st.markdown("🔥 **3x Higher Converting Re-Hook Script:**")
                st.info(f"\"{hook.get('rehook_suggestion', 'N/A')}\"")
                st.markdown("</div>", unsafe_allow_html=True)

            with col_s2:
                st.markdown("<div class='card-box'>", unsafe_allow_html=True)
                st.markdown("🟢 **Script Strengths:**")
                for str_item in hook.get("script_strengths", []):
                    st.markdown(f"- {str_item}")
                    
                st.markdown("<br>🔴 **Script Weaknesses / Drop-off Risks:**", unsafe_allow_html=True)
                for weak_item in hook.get("script_weaknesses", []):
                    st.markdown(f"- {weak_item}")
                st.markdown("</div>", unsafe_allow_html=True)

        # --- Section 2: Multimodal Visual Keyframe Check ---
        st.markdown("### 🖼️ Multimodal Visual & Frame Quality Check")
        if st.session_state.extracted_frames:
            cols_img = st.columns(len(st.session_state.extracted_frames))
            for idx, img in enumerate(st.session_state.extracted_frames):
                ts = st.session_state.frame_timestamps[idx] if idx < len(st.session_state.frame_timestamps) else idx
                with cols_img[idx]:
                    st.image(img, caption=f"Keyframe @ {ts}s", use_container_width=True)
                    
        col_v1, col_v2 = st.columns(2)
        with col_v1:
            st.markdown("<div class='card-box'>", unsafe_allow_html=True)
            st.markdown("**Framing & Subject Positioning:**")
            st.write(visual.get("framing_critique", "N/A"))
            
            st.markdown("**On-Screen Graphics & Text:**")
            st.write(visual.get("text_on_screen_analysis", "N/A"))
            st.markdown("</div>", unsafe_allow_html=True)

        with col_v2:
            st.markdown("<div class='card-box'>", unsafe_allow_html=True)
            st.markdown("**Lighting & Color Harmony:**")
            st.write(visual.get("lighting_and_color", "N/A"))
            
            st.markdown("**Thumbnail & Visual Hook Appeal:**")
            st.write(visual.get("thumbnail_potential", "N/A"))
            
            st.markdown("**Visual Improvement Tips:**")
            for v_tip in visual.get("visual_improvements", []):
                st.markdown(f"- 💡 {v_tip}")
            st.markdown("</div>", unsafe_allow_html=True)

        # --- Section 3: Audience Sentiment & Mining ---
        st.markdown("### 💬 Audience Requests & Friction Points")
        st.markdown("<div class='card-box'>", unsafe_allow_html=True)
        col_m1, col_m2, col_m3 = st.columns(3)
        with col_m1:
            st.markdown("❓ **Recurring Questions Viewers Asked:**")
            for q in sentiment.get("recurring_questions", []):
                st.markdown(f"- {q}")
        with col_m2:
            st.markdown("⚠️ **Friction Points & Complaints:**")
            for f in sentiment.get("friction_points", []):
                st.markdown(f"- {f}")
        with col_m3:
            st.markdown("💡 **Content Ideas Demanded by Viewers:**")
            for idea in sentiment.get("content_ideas_from_comments", []):
                st.markdown(f"- 🎯 {idea}")
        st.markdown("</div>", unsafe_allow_html=True)

        # --- Section 4: Top 3 to 5 Domain Creator Benchmark Matrix ---
        st.markdown("### ⚔️ Top 3–5 Domain Creator Benchmark Matrix")
        
        creators_list = gap.get("top_3_to_5_creators", []) or gap.get("top_3_creators", [])
        if creators_list:
            cols_c = st.columns(min(len(creators_list), 5))
            for idx, cr in enumerate(creators_list):
                with cols_c[idx]:
                    st.markdown("<div class='card-box'>", unsafe_allow_html=True)
                    st.markdown(f"#### 👤 {cr.get('creator_name', f'Creator {idx+1}')}")
                    st.divider()
                    
                    st.markdown("🟢 **Plus Points (+):**")
                    for p in cr.get("plus_points", []):
                        st.markdown(f"- {p}")
                        
                    st.markdown("<br>🔴 **Minus Points (-):**", unsafe_allow_html=True)
                    for m in cr.get("minus_points", []):
                        st.markdown(f"- {m}")
                        
                    st.markdown("<br>💡 **Takeaway for Target Influencer:**", unsafe_allow_html=True)
                    st.info(cr.get("takeaway_for_influencer", "N/A"))
                    st.markdown("</div>", unsafe_allow_html=True)
        else:
            st.write(gap.get("niche_positioning", "No top creator benchmark generated."))

        # --- Overall Synthesis Banner ---
        st.markdown("### 🌟 Overall Synthesis & Master Niche Blueprint")
        synth = gap.get("overall_synthesis", {})
        if synth:
            st.markdown("<div class='card-box' style='border: 1px solid #7928CA;'>", unsafe_allow_html=True)
            col_syn1, col_syn2 = st.columns(2)
            with col_syn1:
                st.markdown("**Unified Industry Formula Across All 3 Creators:**")
                st.write(synth.get("unified_meaning", "N/A"))
                
                st.markdown("<br>**Master Differentiation Formula:**", unsafe_allow_html=True)
                st.success(synth.get("master_differentiation_formula", "N/A"))
            with col_syn2:
                st.markdown("**Unexploited Niche Gaps to Dominance:**")
                for gap_item in synth.get("niche_gaps_to_exploit", []):
                    st.markdown(f"- 🚀 {gap_item}")
            st.markdown("</div>", unsafe_allow_html=True)


# ==========================================
# TAB 3: 14-DAY GROWTH STRATEGY
# ==========================================
with tab_strategy:
    if not st.session_state.growth_strategy:
        st.info("💡 No growth strategy calendar generated yet. Run the analysis in **Tab 1** first.")
    else:
        strat = st.session_state.growth_strategy
        
        st.markdown("### 🚀 14-Day Actionable Growth Calendar")
        
        col_g1, col_g2 = st.columns([2, 1])
        with col_g1:
            st.markdown(f"**Recommended Format Mix:** `{strat.get('recommended_format_mix', '70% Shorts / 30% Long-form')}`")
        with col_g2:
            st.markdown("**Key Editing Rules:**")
            for rule in strat.get("key_editing_guidelines", []):
                st.markdown(f"- ✂️ {rule}")

        st.divider()

        calendar = strat.get("calendar", [])
        if calendar:
            for item in calendar:
                day_num = item.get("day", 1)
                fmt = item.get("format", "Shorts")
                title = item.get("title", f"Day {day_num} Content Concept")
                hook = item.get("hook_script", "")
                angle = item.get("core_angle", "")
                
                fmt_badge = '<span class="badge-shorts">Shorts / Reel</span>' if "short" in fmt.lower() else '<span class="badge-long">Long-form</span>'
                
                with st.expander(f"📅 Day {day_num}: {title}"):
                    st.markdown(f"**Format:** {fmt_badge}", unsafe_allow_html=True)
                    st.markdown(f"**Opening 3-Second Hook Script:**")
                    st.info(f"\"{hook}\"")
                    st.markdown(f"**Core Value Angle:** {angle}")
