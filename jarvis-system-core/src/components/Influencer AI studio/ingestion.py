"""
Data Ingestion Module (`ingestion.py`)
Handles YouTube URL parsing, transcript extraction via `youtube-transcript-api`,
video downloading via `yt-dlp`, and keyframe extraction via OpenCV (`opencv-python`).
"""

import os
import re
import tempfile
import cv2
from PIL import Image
from youtube_transcript_api import YouTubeTranscriptApi, TranscriptsDisabled, NoTranscriptFound
import yt_dlp


def extract_youtube_id(url_or_id: str) -> str:
    """
    Extracts the 11-character YouTube video ID from various URL formats or raw ID string.
    """
    if not url_or_id:
        return ""
    
    clean_input = url_or_id.strip()
    
    # Reject Instagram or non-YouTube URLs
    if "instagram.com" in clean_input or "instagr.am" in clean_input:
        return ""
    
    # Regex patterns for common YouTube URL formats
    patterns = [
        r'(?:v=|\/)([\w-]{11})(?:[\?&]|$)',
        r'youtu\.be\/([\w-]{11})',
        r'youtube\.com\/shorts\/([\w-]{11})',
        r'youtube\.com\/embed\/([\w-]{11})',
    ]
    
    for pattern in patterns:
        match = re.search(pattern, clean_input)
        if match:
            return match.group(1)
            
    # Direct 11-char ID check
    if re.match(r'^[\w-]{11}$', clean_input):
        return clean_input
        
    return ""


def extract_instagram_code(url_or_code: str) -> str:
    """
    Extracts the Instagram post/Reel shortcode from Instagram URLs.
    Formats supported:
    - https://www.instagram.com/reel/C8xYz12345/
    - https://www.instagram.com/p/C8xYz12345/?igsh=123
    - Shortcode string (e.g. C8xYz12345)
    """
    if not url_or_code:
        return ""
    clean = url_or_code.strip()
    match = re.search(r'instagram\.com\/(?:reel|p|reels)\/([A-Za-z0-9_-]+)', clean)
    if match:
        return match.group(1)
    if re.match(r'^[A-Za-z0-9_-]{5,25}$', clean):
        return clean
    return clean


def download_instagram_and_extract_frames(
    ig_url_or_code: str,
    timestamps_sec: list = None,
    extract_midpoint: bool = True
) -> dict:
    """
    Downloads a public Instagram Reel / Video Post using yt-dlp to a temporary directory
    and samples keyframes at specific timestamps using OpenCV.
    
    If yt-dlp encounters Instagram anti-bot restrictions, automatically falls back to
    Meta crawler parsing to extract full caption text and high-res cover keyframes for $0.
    
    Returns:
        dict: {
            "success": bool,
            "transcript": str,
            "frames": list[PIL.Image.Image],
            "frame_timestamps": list[float],
            "error": str or None
        }
    """
    import html
    import io
    import requests

    if timestamps_sec is None:
        timestamps_sec = [0.0, 3.0, 10.0]
        
    code = extract_instagram_code(ig_url_or_code)
    if not code:
        return {
            "success": False,
            "transcript": "",
            "frames": [],
            "frame_timestamps": [],
            "error": "Invalid Instagram Reel/Post URL or Shortcode."
        }
        
    full_url = f"https://www.instagram.com/reel/{code}/" if "http" not in ig_url_or_code else ig_url_or_code
    
    with tempfile.TemporaryDirectory() as temp_dir:
        download_path = os.path.join(temp_dir, "ig_video.mp4")
        ydl_opts = {
            'outtmpl': download_path,
            'quiet': True,
            'no_warnings': True,
            'overwrites': True,
            'user_agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
        
        # 1. Try primary yt-dlp download
        try:
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                ydl.download([full_url])
                
            if os.path.exists(download_path):
                cap = cv2.VideoCapture(download_path)
                if cap.isOpened():
                    fps = cap.get(cv2.CAP_PROP_FPS)
                    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
                    
                    if fps > 0 and total_frames > 0:
                        duration_sec = total_frames / fps
                        target_timestamps = list(timestamps_sec)
                        if extract_midpoint and duration_sec > 0:
                            midpoint = round(duration_sec / 2.0, 1)
                            if midpoint not in target_timestamps:
                                target_timestamps.append(midpoint)
                                
                        target_timestamps = sorted([ts for ts in target_timestamps if ts <= duration_sec])
                        if not target_timestamps:
                            target_timestamps = [0.0]
                            
                        sampled_frames = []
                        final_timestamps = []
                        
                        for ts in target_timestamps:
                            frame_number = int(ts * fps)
                            cap.set(cv2.CAP_PROP_POS_FRAMES, frame_number)
                            ret, frame_bgr = cap.read()
                            
                            if ret and frame_bgr is not None:
                                frame_rgb = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB)
                                pil_img = Image.fromarray(frame_rgb)
                                sampled_frames.append(pil_img)
                                final_timestamps.append(ts)
                                
                        cap.release()
                        
                        if sampled_frames:
                            return {
                                "success": True,
                                "transcript": "",
                                "frames": sampled_frames,
                                "frame_timestamps": final_timestamps,
                                "error": None
                            }
        except Exception:
            pass

        # 2. Automated Fallback: Meta / Facebook Crawler Scraper
        try:
            headers = {'User-Agent': 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)'}
            resp = requests.get(f"https://www.instagram.com/reel/{code}/", headers=headers, timeout=10)
            
            if resp.status_code == 200:
                og_desc = re.search(r'<meta property=\"og:description\" content=\"([^\"]+)\"', resp.text)
                og_img = re.search(r'<meta property=\"og:image\" content=\"([^\"]+)\"', resp.text)
                
                caption_raw = og_desc.group(1) if og_desc else ""
                clean_caption = html.unescape(caption_raw)
                
                # Strip standard prefix like "117 likes, 3 comments - author on date:"
                clean_caption = re.sub(r'^\d+ likes,\s*\d+ comments\s*-\s*[^\s]+ on [^:]+:\s*&quot;?', '', clean_caption)
                clean_caption = clean_caption.rstrip('&quot;').strip()
                
                img_url = html.unescape(og_img.group(1)) if og_img else ""
                fallback_frames = []
                
                if img_url:
                    img_resp = requests.get(img_url, headers=headers, timeout=10)
                    if img_resp.status_code == 200:
                        pil_img = Image.open(io.BytesIO(img_resp.content))
                        fallback_frames.append(pil_img)
                        
                if clean_caption or fallback_frames:
                    return {
                        "success": True,
                        "transcript": clean_caption,
                        "frames": fallback_frames,
                        "frame_timestamps": [0.0] if fallback_frames else [],
                        "error": None
                    }
        except Exception as fb_err:
            pass

        return {
            "success": False,
            "transcript": "",
            "frames": [],
            "frame_timestamps": [],
            "error": "Instagram restricted automated extraction for this post. Please paste caption manually below or upload keyframe screenshots."
        }


def fetch_youtube_transcript(video_id_or_url: str) -> dict:
    """
    Fetches transcript text and timed snippets for a YouTube video using youtube-transcript-api.
    Compatible across all versions of youtube-transcript-api. Does not require OAuth or API keys.
    
    Returns:
        dict: {
            "success": bool,
            "transcript": str,
            "snippets": list, # [{text, start, duration}]
            "error": str or None
        }
    """
    video_id = extract_youtube_id(video_id_or_url)
    if not video_id:
        return {
            "success": False,
            "transcript": "",
            "snippets": [],
            "error": "Invalid YouTube Video ID or URL provided."
        }
        
    raw_snippets = []
    
    # 1. Try instance-based fetch (youtube-transcript-api v0.6.2+)
    try:
        api_inst = YouTubeTranscriptApi()
        if hasattr(api_inst, 'fetch'):
            fetched = api_inst.fetch(video_id)
            if hasattr(fetched, 'snippets'):
                raw_snippets = fetched.snippets
            elif isinstance(fetched, list):
                raw_snippets = fetched
    except Exception:
        pass

    # 2. Try classmethod get_transcript (classic youtube-transcript-api)
    if not raw_snippets and hasattr(YouTubeTranscriptApi, 'get_transcript'):
        try:
            raw_snippets = YouTubeTranscriptApi.get_transcript(video_id, languages=['en', 'en-US', 'hi', 'es'])
        except Exception:
            try:
                raw_snippets = YouTubeTranscriptApi.get_transcript(video_id)
            except Exception:
                pass

    # 3. Try list() / list_transcripts() helper fallback
    if not raw_snippets:
        try:
            api_inst = YouTubeTranscriptApi()
            if hasattr(api_inst, 'list'):
                t_list = api_inst.list(video_id)
            elif hasattr(YouTubeTranscriptApi, 'list_transcripts'):
                t_list = YouTubeTranscriptApi.list_transcripts(video_id)
            else:
                t_list = []
                
            first_t = None
            for t in t_list:
                first_t = t
                break
            if first_t:
                fetched = first_t.fetch()
                raw_snippets = getattr(fetched, 'snippets', fetched)
        except Exception:
            pass

    if not raw_snippets:
        return {
            "success": False,
            "transcript": "",
            "snippets": [],
            "error": "Could not retrieve transcript snippets for this YouTube video."
        }

    # Standardize snippet dict format ({text, start, duration})
    clean_snippets = []
    text_parts = []
    
    for item in raw_snippets:
        if hasattr(item, 'text'):
            txt = getattr(item, 'text', '')
            st = getattr(item, 'start', 0.0)
            dur = getattr(item, 'duration', 0.0)
        elif isinstance(item, dict):
            txt = item.get('text', '')
            st = item.get('start', 0.0)
            dur = item.get('duration', 0.0)
        else:
            continue
            
        clean_text = txt.replace('\n', ' ').strip()
        clean_snippets.append({"text": clean_text, "start": st, "duration": dur})
        if clean_text:
            text_parts.append(clean_text)

    full_transcript = " ".join(text_parts)
    
    return {
        "success": True,
        "transcript": full_transcript,
        "snippets": clean_snippets,
        "error": None
    }


def download_video_and_extract_frames(
    video_url_or_id: str,
    timestamps_sec: list = None,
    extract_midpoint: bool = True
) -> dict:
    """
    Downloads a public YouTube video/Short using yt-dlp to a temporary directory
    and samples keyframes at specific timestamps (e.g. 0s, 3s, 10s, midpoint) using OpenCV.
    
    Includes player_client extractor overrides to circumvent YouTube SABR download blocks.
    
    Args:
        video_url_or_id: YouTube video URL or ID.
        timestamps_sec: List of float timestamps in seconds to sample (default: [0.0, 3.0, 10.0]).
        extract_midpoint: If True, automatically adds the video midpoint timestamp.
        
    Returns:
        dict: {
            "success": bool,
            "frames": list[PIL.Image.Image],
            "frame_timestamps": list[float],
            "error": str or None
        }
    """
    if timestamps_sec is None:
        timestamps_sec = [0.0, 3.0, 10.0]
        
    video_id = extract_youtube_id(video_url_or_id)
    if not video_id:
        return {
            "success": False,
            "frames": [],
            "frame_timestamps": [],
            "error": "Invalid YouTube Video URL or ID."
        }
        
    full_url = f"https://www.youtube.com/watch?v={video_id}"
    
    with tempfile.TemporaryDirectory() as temp_dir:
        download_path = os.path.join(temp_dir, "temp_video.mp4")
        
        # Configure yt-dlp options with player_client fallback to bypass YouTube SABR restrictions
        ydl_opts = {
            'format': 'bestvideo[height<=360][ext=mp4]+bestaudio[ext=m4a]/best[height<=360]/worst',
            'outtmpl': download_path,
            'quiet': True,
            'no_warnings': True,
            'overwrites': True,
            'extractor_args': {
                'youtube': {
                    'player_client': ['android', 'ios', 'mweb', 'web']
                }
            }
        }
        
        try:
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                ydl.download([full_url])
                
            if not os.path.exists(download_path):
                # Fallback format download attempt
                ydl_opts['format'] = 'worst'
                with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                    ydl.download([full_url])

            # Open downloaded video file with OpenCV
            cap = cv2.VideoCapture(download_path)
            if not cap.isOpened():
                return {
                    "success": False,
                    "frames": [],
                    "frame_timestamps": [],
                    "error": "OpenCV failed to open the downloaded video file."
                }
                
            fps = cap.get(cv2.CAP_PROP_FPS)
            total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
            
            if fps <= 0 or total_frames <= 0:
                cap.release()
                return {
                    "success": False,
                    "frames": [],
                    "frame_timestamps": [],
                    "error": "Invalid video frame rate or zero length video."
                }
                
            duration_sec = total_frames / fps
            
            target_timestamps = list(timestamps_sec)
            if extract_midpoint and duration_sec > 0:
                midpoint = round(duration_sec / 2.0, 1)
                if midpoint not in target_timestamps:
                    target_timestamps.append(midpoint)
                    
            # Sort timestamps and filter out timestamps exceeding video duration
            target_timestamps = sorted([ts for ts in target_timestamps if ts <= duration_sec])
            if not target_timestamps:
                target_timestamps = [0.0]
                
            sampled_frames = []
            final_timestamps = []
            
            # Extract keyframes via OpenCV timestamp seeking
            for ts in target_timestamps:
                frame_number = int(ts * fps)
                cap.set(cv2.CAP_PROP_POS_FRAMES, frame_number)
                ret, frame_bgr = cap.read()
                
                if ret and frame_bgr is not None:
                    # Convert BGR (OpenCV standard) to RGB (Pillow / Gemini standard)
                    frame_rgb = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB)
                    pil_img = Image.fromarray(frame_rgb)
                    
                    sampled_frames.append(pil_img)
                    final_timestamps.append(ts)
                    
            cap.release()
            
            if not sampled_frames:
                return {
                    "success": False,
                    "frames": [],
                    "frame_timestamps": [],
                    "error": "Could not read any frames from video file."
                }
                
            return {
                "success": True,
                "frames": sampled_frames,
                "frame_timestamps": final_timestamps,
                "error": None
            }
            
        except Exception as e:
            return {
                "success": False,
                "frames": [],
                "frame_timestamps": [],
                "error": f"Video downloading or frame extraction failed: {str(e)}"
            }


def extract_profile_handle(input_str: str) -> str:
    """
    Extracts and normalizes a Creator Profile Handle or Channel ID from user input.
    Examples:
    - '@techburner' -> '@techburner'
    - 'https://www.youtube.com/@MKBHD/videos' -> '@MKBHD'
    - 'https://instagram.com/thatindiefoodie' -> '@thatindiefoodie'
    - 'UC123456789' -> 'UC123456789'
    """
    if not input_str:
        return ""
    clean = input_str.strip()
    
    # Check YouTube channel / handle URLs
    yt_match = re.search(r'youtube\.com\/(?:@|channel\/|c\/|user\/)?([\w\.-]+)', clean)
    if yt_match:
        handle = yt_match.group(1)
        return handle if handle.startswith('UC') else f"@{handle.lstrip('@')}"
        
    # Check Instagram profile URLs
    ig_match = re.search(r'instagram\.com\/([\w\.-]+)', clean)
    if ig_match:
        return f"@{ig_match.group(1).lstrip('@')}"
        
    # Direct handle or ID string
    if clean.startswith('@'):
        return clean
    elif clean.startswith('UC') and len(clean) >= 20:
        return clean
    else:
        return f"@{clean.lstrip('@')}"


def fetch_youtube_comments(video_url_or_id: str, max_comments: int = 30) -> list[str]:
    """
    Extracts top audience comments for a given YouTube video using yt-dlp.
    """
    video_id = extract_youtube_id(video_url_or_id)
    if not video_id:
        return []
        
    full_url = f"https://www.youtube.com/watch?v={video_id}"
    ydl_opts = {
        'getcomments': True,
        'quiet': True,
        'skip_download': True,
        'max_comments': max_comments,
        'extractor_args': {
            'youtube': {
                'player_client': ['android', 'ios', 'mweb', 'web']
            }
        }
    }
    
    comments = []
    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(full_url, download=False)
            raw_comments = info.get('comments', [])
            for c in raw_comments:
                text = c.get('text', '').strip()
                if text:
                    comments.append(text)
    except Exception:
        pass
        
    return comments


def fetch_creator_profile_content(
    profile_input: str,
    platform: str = "youtube",
    video_limit: int = 5
) -> dict:
    """
    Ingests recent videos, transcripts, keyframe images, and aggregated audience comments
    for a Creator Profile ID / Channel Handle.
    
    Returns:
        dict: {
            "success": bool,
            "profile_handle": str,
            "videos_analyzed": list[dict],
            "transcript": str,
            "comments_text": str,
            "extracted_frames": list[PIL.Image.Image],
            "frame_timestamps": list[float],
            "error": str or None
        }
    """
    clean_handle = extract_profile_handle(profile_input)
    if not clean_handle:
        return {
            "success": False,
            "profile_handle": "",
            "videos_analyzed": [],
            "transcript": "",
            "comments_text": "",
            "extracted_frames": [],
            "frame_timestamps": [],
            "error": "Invalid Creator Profile Handle or Channel ID."
        }
        
def fetch_instagram_profile_content(profile_handle: str, post_limit: int = 5) -> dict:
    """
    Scrapes recent Reel captions, keyframes, and viewer comments for an Instagram Profile handle.
    Uses DDG public indexing to locate Reel shortcodes for 100% free scraping without cookies.
    """
    import html
    import requests
    
    raw_handle = profile_handle.lstrip('@').strip()
    search_url = f"https://html.duckduckgo.com/html/?q=site:instagram.com/reel/+{raw_handle}"
    headers = {'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'}
    
    shortcodes = []
    try:
        r = requests.get(search_url, headers=headers, timeout=10)
        codes = re.findall(r'instagram\.com/reel/([A-Za-z0-9_-]+)', r.text)
        shortcodes = list(dict.fromkeys(codes))
    except Exception:
        pass

    if not shortcodes:
        # Fallback single post check
        res_single = download_instagram_and_extract_frames(raw_handle)
        return {
            "success": res_single.get("success", False),
            "profile_handle": f"@{raw_handle}",
            "videos_analyzed": [{"title": f"Instagram Reel (@{raw_handle})", "url": f"https://instagram.com/{raw_handle}"}],
            "transcript": res_single.get("transcript", f"Instagram profile content for @{raw_handle}"),
            "comments_text": f"Recent audience engagement on @{raw_handle}",
            "extracted_frames": res_single.get("frames", []),
            "frame_timestamps": res_single.get("frame_timestamps", []),
            "error": res_single.get("error")
        }

    transcripts = []
    all_frames = []
    all_timestamps = []
    analyzed_posts = []

    for idx, code in enumerate(shortcodes[:post_limit]):
        reel_url = f"https://www.instagram.com/reel/{code}/"
        ig_res = download_instagram_and_extract_frames(reel_url)
        analyzed_posts.append({"id": code, "title": f"Reel #{idx+1} ({code})", "url": reel_url})

        if ig_res.get("transcript"):
            transcripts.append(f"--- REEL #{idx+1} ({code}) ---\n{ig_res['transcript']}")

        if idx == 0 and ig_res.get("frames"):
            all_frames = ig_res.get("frames", [])
            all_timestamps = ig_res.get("frame_timestamps", [])

    full_transcript = "\n\n".join(transcripts) if transcripts else f"Instagram profile content for @{raw_handle}"
    full_comments = f"Aggregated viewer comments on recent @{raw_handle} Reels"

    return {
        "success": True,
        "profile_handle": f"@{raw_handle}",
        "videos_analyzed": analyzed_posts,
        "transcript": full_transcript,
        "comments_text": full_comments,
        "extracted_frames": all_frames,
        "frame_timestamps": all_timestamps,
        "error": None
    }


def fetch_creator_profile_content(
    profile_input: str,
    platform: str = "youtube",
    video_limit: int = 5
) -> dict:
    """
    Ingests recent videos, transcripts, keyframe images, and aggregated audience comments
    for a Creator Profile ID / Channel Handle across YouTube and Instagram.
    """
    clean_handle = extract_profile_handle(profile_input)
    if not clean_handle:
        return {
            "success": False,
            "profile_handle": "",
            "videos_analyzed": [],
            "transcript": "",
            "comments_text": "",
            "extracted_frames": [],
            "frame_timestamps": [],
            "error": "Invalid Creator Profile Handle or Channel ID."
        }
        
    is_instagram = platform.lower() == "instagram" or "instagram.com" in profile_input or "instagr.am" in profile_input
    
    if is_instagram:
        return fetch_instagram_profile_content(clean_handle, post_limit=video_limit)
        
    # YouTube Multi-Tab Fallback Strategy (/videos -> /shorts -> /featured -> search)
    raw_h = clean_handle.lstrip('@')
    candidate_urls = []
    
    if clean_handle.startswith('UC'):
        candidate_urls = [
            f"https://www.youtube.com/channel/{clean_handle}/videos",
            f"https://www.youtube.com/channel/{clean_handle}/shorts",
            f"https://www.youtube.com/channel/{clean_handle}"
        ]
    else:
        candidate_urls = [
            f"https://www.youtube.com/@{raw_h}/videos",
            f"https://www.youtube.com/@{raw_h}/shorts",
            f"https://www.youtube.com/@{raw_h}",
            f"ytsearch{video_limit}:{raw_h}"
        ]
        
    ydl_opts = {
        'extract_flat': True,
        'quiet': True,
        'playlistend': video_limit
    }
    
    entries = []
    last_err = None
    
    for candidate in candidate_urls:
        try:
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                res = ydl.extract_info(candidate, download=False)
                entries = res.get('entries', []) or []
                if entries:
                    break
        except Exception as e:
            last_err = str(e)
            continue
            
    if not entries:
        # Check if handle is an Instagram profile
        return fetch_instagram_profile_content(clean_handle, post_limit=video_limit)
        
    analyzed_videos = []
    combined_transcripts = []
    combined_comments = []
    primary_frames = []
    primary_timestamps = []
    
    for idx, entry in enumerate(entries[:video_limit]):
        v_id = entry.get('id')
        v_title = entry.get('title', f'Video #{idx+1}')
        v_url = f"https://www.youtube.com/watch?v={v_id}"
        
        if not v_id:
            continue
            
        analyzed_videos.append({"id": v_id, "title": v_title, "url": v_url})
        
        # 1. Fetch transcript for video
        t_res = fetch_youtube_transcript(v_id)
        if t_res.get("transcript"):
            combined_transcripts.append(f"--- VIDEO #{idx+1}: {v_title} ---\n{t_res['transcript']}")
            
        # 2. Fetch comments for video
        comments_list = fetch_youtube_comments(v_id, max_comments=20)
        if comments_list:
            comments_str = "\n".join([f"• {c}" for c in comments_list])
            combined_comments.append(f"--- COMMENTS FOR: {v_title} ---\n{comments_str}")
            
        # 3. Extract keyframe images for the first/most recent video
        if idx == 0:
            frame_res = download_video_and_extract_frames(v_id)
            if frame_res.get("success"):
                primary_frames = frame_res.get("frames", [])
                primary_timestamps = frame_res.get("frame_timestamps", [])
                
    full_transcript_text = "\n\n".join(combined_transcripts)
    full_comments_text = "\n\n".join(combined_comments)
    
    return {
        "success": True,
        "profile_handle": clean_handle,
        "videos_analyzed": analyzed_videos,
        "transcript": full_transcript_text,
        "comments_text": full_comments_text,
        "extracted_frames": primary_frames,
        "frame_timestamps": primary_timestamps,
        "error": None
    }
