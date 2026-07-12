import asyncio
import argparse
import os
import db_compat as aiosqlite  # match V3_updates: Turso in prod, local file in dev
from influencer_agent import (
    fetch_instagram_posts,
    fetch_twitter_tweets,
    fetch_youtube_videos,
    filter_new_posts
)
import V3_updates

DB_PATH = os.environ.get("DB_PATH", "agent_memory.db")

async def add_and_test_influencer(platform: str, handle: str, name: str):
    platform = platform.strip().lower()
    handle = handle.strip()
    name = name.strip() or handle

    if platform not in ["instagram", "twitter", "x", "youtube"]:
        print(f"❌ Error: Unsupported platform '{platform}'. Choose from instagram, twitter/x, youtube.")
        return

    print(f"🔄 Registering {name} ({platform}) under handle/ID: '{handle}'...")
    async with aiosqlite.connect(DB_PATH) as db:
        try:
            await db.execute(
                "INSERT INTO watched_influencers (handle, platform, name) VALUES (?, ?, ?)",
                (handle, platform, name)
            )
            await db.commit()
            print(f"✅ Success: Added {name} to watched list.")
        except aiosqlite.IntegrityError:
            print(f"ℹ️ Note: {name} is already registered in the database. Proceeding to test scrape...")

    print(f"\n⚡ Instantly fetching latest details for {name} on {platform}...")
    raw_posts = []
    if platform == "instagram":
        raw_posts = await fetch_instagram_posts(handle)
    elif platform in ["twitter", "x"]:
        raw_posts = await fetch_twitter_tweets(handle)
    elif platform == "youtube":
        raw_posts = await fetch_youtube_videos(handle)

    if not raw_posts:
        print(f"❌ Failed to fetch any posts. Check handle validity, RapidAPI limits, or connection logs.")
        return

    print(f"✨ Successfully retrieved {len(raw_posts)} recent entries:")
    for idx, post in enumerate(raw_posts[:3], 1):
        preview = post["text"][:120] + "..." if len(post["text"]) > 120 else post["text"]
        print(f"  {idx}. [ID: {post['post_id']}] {preview}")
        print(f"     URL: {post['url']}")

    async with aiosqlite.connect(DB_PATH) as db:
        new_posts = await filter_new_posts(db, platform, handle, raw_posts)
        await db.commit()

    if not new_posts:
        print(f"\n✓ These posts have already been processed in your daily digest database.")
        return

    # Trigger real-time LLM summarization check
    print(f"\n🤖 Running real-time JARVIS summarizer...")
    prompt_content = ""
    for idx, post in enumerate(new_posts[:5], 1):
        prompt_content += f"{idx}. {post['text']}\n"

    system_prompt = (
        "You are JARVIS, Madan's AI assistant. Summarize the latest updates from this influencer "
        "wittily in 1-2 sentences. Keep it short, sharp, and focused on value."
    )

    try:
        summary = await V3_updates.call_llm(system_prompt, f"LATEST POSTS:\n{prompt_content}")
        print(f"\n======================================")
        print(f"💬 JARVIS Summary:")
        print(summary)
        print(f"======================================")
        
        # Save summary to notifications
        async with aiosqlite.connect(DB_PATH) as db:
            await db.execute(
                "INSERT INTO notifications (body, category) VALUES (?, 'influencer')",
                (f"**Real-time sync for {name}**:\n{summary}",)
            )
            await db.commit()
            print("💾 Saved summary card to your console inbox.")
    except Exception as e:
        print(f"⚠️ LLM summarization failed: {e}")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Watch and instantly scrape a new social media influencer.")
    parser.add_argument("--platform", required=True, help="Social platform: instagram, twitter/x, youtube")
    parser.add_argument("--handle", required=True, help="Username handle or YouTube Channel ID")
    parser.add_argument("--name", default="", help="Display name for the watched profile")

    args = parser.parse_args()
    asyncio.run(add_and_test_influencer(args.platform, args.handle, args.name))
