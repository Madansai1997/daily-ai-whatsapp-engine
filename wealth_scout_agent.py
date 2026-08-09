"""
wealth_scout_agent.py — Specialized India & Global Wealth Management Job Scout Module.

Focuses on Wealth Management, Private Banking, HNW/UHNW Relationship Management,
Investment Advisory, and Family Office opportunities across India & global financial hubs.
"""

import os
import json
import asyncio
import urllib.request
import urllib.parse
from datetime import datetime, timezone
import aiosqlite

DB_PATH = os.getenv("DB_PATH", "agent_memory.db")

CURATED_WEALTH_CATALOG = [
    {
        "job_key": "curated:nuvama_1",
        "title": "Senior Relationship Manager — UHNI Wealth Management",
        "company": "Nuvama Wealth",
        "location": "Mumbai (BKC), India",
        "description": "Managing UHNWI portfolios (>₹25 Cr AUM), asset allocation across AIFs, PMS, and global private equity. Structuring family office investments.",
        "url": "https://nuvama.com/careers",
        "salary": "₹35,00,000 - ₹50,00,000 / yr + Performance Incentives",
        "source": "Nuvama Careers",
        "tags": "Private Banking, UHNI Wealth, Family Office"
    },
    {
        "job_key": "curated:360one_2",
        "title": "Private Banker / VP — Wealth Advisory",
        "company": "360 ONE (IIFL Wealth)",
        "location": "Gurgaon / Delhi NCR, India",
        "description": "Leading wealth advisory for ultra-high-net-worth clients, corporate promoters, and tech founders. Managing multi-asset investment strategies.",
        "url": "https://360.one/careers",
        "salary": "₹40,00,000 - ₹60,00,000 / yr",
        "source": "360 ONE Careers",
        "tags": "Private Banking, HNW Advisory"
    },
    {
        "job_key": "curated:barclays_3",
        "title": "Director — Private Banking & Wealth Structuring",
        "company": "Barclays Private Bank",
        "location": "Mumbai / Dubai (NRI Desk)",
        "description": "Structuring cross-border wealth solutions, estate planning, and debt/equity syndicate for Indian promoters and NRI family offices.",
        "url": "https://barclays.com/careers",
        "salary": "Competitive International Package",
        "source": "Barclays Global Careers",
        "tags": "Offshore Wealth, NRI Advisory, Private Banking"
    },
    {
        "job_key": "curated:avendus_4",
        "title": "Associate Vice President — Family Office & Wealth Solutions",
        "company": "Avendus Capital",
        "location": "Bengaluru, India",
        "description": "Advising tech founders and venture-backed entrepreneurs on liquidity events, estate planning, and private market allocations.",
        "url": "https://avendus.com/careers",
        "salary": "₹30,00,000 - ₹45,00,000 / yr",
        "source": "Avendus Careers",
        "tags": "Venture Wealth, Family Office, Private Markets"
    },
    {
        "job_key": "curated:kotak_5",
        "title": "Senior Private Banker — Ultra High Net Worth",
        "company": "Kotak Wealth Management",
        "location": "Mumbai (Nariman Point), India",
        "description": "Acquiring and managing promoter families with ₹50 Cr+ investible surplus. Delivering customized fixed income, equity PMS, and succession planning.",
        "url": "https://www.kotak.com/en/careers.html",
        "salary": "₹38,00,000 - ₹55,00,000 / yr",
        "source": "Kotak Careers",
        "tags": "Private Banking, UHNW"
    },
    {
        "job_key": "curated:hdfc_6",
        "title": "Cluster Head / VP — Private Banking",
        "company": "HDFC Bank Private Banking",
        "location": "Delhi NCR / Gurgaon, India",
        "description": "Leading senior private bankers across North India, driving AUM growth in structured credit, offshore funds, and family trusts.",
        "url": "https://www.hdfcbank.com/personal/about-us/careers",
        "salary": "₹42,00,000 - ₹65,00,000 / yr",
        "source": "HDFC Careers",
        "tags": "Private Banking, Leadership"
    },
    {
        "job_key": "curated:waterfield_7",
        "title": "Investment Director — Multi-Family Office",
        "company": "Waterfield Advisors",
        "location": "Mumbai, India",
        "description": "Advising multi-generational business families on conflict-free asset allocation, unlisted equity, and philanthropic endowments.",
        "url": "https://waterfieldadvisors.com/careers",
        "salary": "₹45,00,000 - ₹70,00,000 / yr",
        "source": "Waterfield Careers",
        "tags": "Family Office, Advisory"
    },
    {
        "job_key": "curated:stanchart_8",
        "title": "Wealth Specialist — Global Indian NRI Banking",
        "company": "Standard Chartered Wealth",
        "location": "Singapore / Dubai Desk",
        "description": "Managing diaspora wealth portfolios for Southeast Asia and Gulf-based Indian business leaders.",
        "url": "https://www.sc.com/en/careers/",
        "salary": "$160,000 - $220,000 SGD / yr",
        "source": "Standard Chartered Careers",
        "tags": "NRI Wealth, Offshore Advisory"
    },
    {
        "job_key": "curated:sanctum_9",
        "title": "Senior Wealth Strategist",
        "company": "Sanctum Wealth",
        "location": "Hyderabad / Bengaluru, India",
        "description": "Providing bespoke portfolio construction and capital protection strategies for corporate executives and entrepreneurs.",
        "url": "https://sanctumwealth.com/careers",
        "salary": "₹28,00,000 - ₹40,00,000 / yr",
        "source": "Sanctum Careers",
        "tags": "Wealth Advisory, Strategy"
    },
    {
        "job_key": "curated:icici_10",
        "title": "Chief Manager — Private Wealth Advisory",
        "company": "ICICI Securities Wealth",
        "location": "Pune / Mumbai, India",
        "description": "Driving comprehensive financial advisory, tax-efficient estate structuring, and derivative hedging strategies for HNI clients.",
        "url": "https://www.icicisecurities.com/careers",
        "salary": "₹25,00,000 - ₹38,00,000 / yr",
        "source": "ICICI Securities Careers",
        "tags": "Private Wealth, Advisory"
    }
]


async def init_wealth_scout_tables():
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("""
            CREATE TABLE IF NOT EXISTS client_wealth_jobs_cache (
                job_key TEXT PRIMARY KEY,
                title TEXT,
                company TEXT,
                location TEXT,
                description TEXT,
                url TEXT,
                salary TEXT,
                source TEXT,
                tags TEXT,
                created_at TEXT
            )
        """)
        await db.commit()


def fetch_adzuna_wealth_jobs(query: str = "Wealth Manager", location: str = "India") -> list:
    """Fetch wealth management jobs from Adzuna India API."""
    app_id = os.getenv("ADZUNA_APP_ID", "")
    app_key = os.getenv("ADZUNA_APP_KEY", "")
    if not app_id or not app_key:
        return []

    url = f"https://api.adzuna.com/v1/api/jobs/in/search/1?app_id={app_id}&app_key={app_key}&results_per_page=15&what={urllib.parse.quote(query)}"
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode())
            results = []
            for item in data.get("results", []):
                results.append({
                    "job_key": f"adzuna:{item.get('id')}",
                    "title": item.get("title", ""),
                    "company": item.get("company", {}).get("display_name", ""),
                    "location": item.get("location", {}).get("display_name", "India"),
                    "description": item.get("description", ""),
                    "url": item.get("redirect_url", ""),
                    "salary": f"₹{item.get('salary_min', '')} - ₹{item.get('salary_max', '')}" if item.get("salary_min") else "Market Competitive",
                    "source": "Adzuna India",
                    "tags": "Private Banking, Wealth Management"
                })
            return results
    except Exception as e:
        print(f"⚠️ Adzuna wealth fetch error: {e}")
        return []


def fetch_jsearch_wealth_jobs(query: str = "Private Banker Wealth Manager", location: str = "India") -> list:
    """Fetch wealth management jobs from JSearch RapidAPI."""
    rapid_key = os.getenv("RAPIDAPI_KEY", "")
    if not rapid_key:
        return []

    q = f"{query} in {location}"
    url = f"https://jsearch.p.rapidapi.com/search-v2?query={urllib.parse.quote(q)}&page=1&num_pages=1"
    headers = {
        "x-rapidapi-key": rapid_key,
        "x-rapidapi-host": "jsearch.p.rapidapi.com"
    }
    try:
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode())
            results = []
            for item in data.get("data", []):
                results.append({
                    "job_key": f"jsearch:{item.get('job_id')}",
                    "title": item.get("job_title", ""),
                    "company": item.get("employer_name", ""),
                    "location": f"{item.get('job_city', '')}, {item.get('job_country', 'India')}".strip(", "),
                    "description": item.get("job_description", "")[:2500],
                    "url": item.get("job_apply_link", "") or item.get("job_google_link", ""),
                    "salary": "Market Competitive",
                    "source": "JSearch Global",
                    "tags": "Private Banking, Wealth Advisor"
                })
            return results
    except Exception as e:
        print(f"⚠️ JSearch wealth fetch error: {e}")
        return []


async def search_wealth_opportunities(role_filter: str = "Wealth Manager", location_filter: str = "India") -> list:
    """Searches and caches live wealth management opportunities for client portal."""
    await init_wealth_scout_tables()
    loop = asyncio.get_running_loop()

    adzuna_jobs, jsearch_jobs = await asyncio.gather(
        loop.run_in_executor(None, lambda: fetch_adzuna_wealth_jobs(role_filter, location_filter)),
        loop.run_in_executor(None, lambda: fetch_jsearch_wealth_jobs(role_filter, location_filter))
    )

    all_jobs = adzuna_jobs + jsearch_jobs
    if not all_jobs:
        # Filter curated catalog based on user query
        rf = role_filter.lower().strip()
        lf = location_filter.lower().strip()
        matched = []
        for c in CURATED_WEALTH_CATALOG:
            loc_match = (not lf) or (lf == "india") or (lf in c["location"].lower())
            role_match = (not rf) or any(w in c["title"].lower() or w in c["tags"].lower() for w in rf.split())
            if loc_match or role_match:
                matched.append(c)
        all_jobs = matched if matched else CURATED_WEALTH_CATALOG[:4]

    now_iso = datetime.now(timezone.utc).isoformat()
    async with aiosqlite.connect(DB_PATH) as db:
        for j in all_jobs:
            await db.execute("DELETE FROM client_wealth_jobs_cache WHERE job_key = ?", (j["job_key"],))
            await db.execute("""
                INSERT INTO client_wealth_jobs_cache
                (job_key, title, company, location, description, url, salary, source, tags, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (j["job_key"], j["title"], j["company"], j["location"], j["description"], j["url"], j["salary"], j["source"], j["tags"], now_iso))
        await db.commit()

    return all_jobs
