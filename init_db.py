import os
import sqlite3

def init_database():
    BASE_DIR = os.path.dirname(os.path.abspath(__file__))
    DB_PATH = os.environ.get("DB_PATH", os.path.join(BASE_DIR, "agent_memory.db"))

    try:
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()

        cursor.execute("""
            CREATE TABLE IF NOT EXISTS sent_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                concept TEXT UNIQUE,
                summary TEXT
            )
        """)

        cursor.execute("""
            CREATE TABLE IF NOT EXISTS user_profile (
                key TEXT PRIMARY KEY,
                value TEXT
            )
        """)

        cursor.execute("""
            CREATE TABLE IF NOT EXISTS knowledge_store (
                url TEXT PRIMARY KEY,
                title TEXT,
                content TEXT,
                saved_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        """)
        # Migration: rename legacy 'timestamp' column to 'saved_at' if the DB
        # was created before this fix was deployed.
        try:
            cols = [row[1] for row in cursor.execute("PRAGMA table_info(knowledge_store)").fetchall()]
            if 'timestamp' in cols and 'saved_at' not in cols:
                cursor.execute("ALTER TABLE knowledge_store RENAME COLUMN timestamp TO saved_at")
        except Exception:
            pass  # SQLite < 3.25 doesn't support RENAME COLUMN

        cursor.execute("""
            CREATE TABLE IF NOT EXISTS review_queue (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                concept TEXT,
                difficulty TEXT,
                reason TEXT,
                due_date TEXT,
                completed INTEGER DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        """)

        cursor.execute("INSERT OR IGNORE INTO user_profile (key, value) VALUES ('skill_level', 'Intermediate')")
        cursor.execute("INSERT OR IGNORE INTO user_profile (key, value) VALUES ('study_streak', '0')")
        cursor.execute("INSERT OR IGNORE INTO user_profile (key, value) VALUES ('last_study_date', '')")

        conn.commit()
        conn.close()
        print(f"💾 Database initialized successfully at: {DB_PATH}")
        return True
    except Exception as e:
        print(f"❌ Database initialization failed: {e}")
        raise

if __name__ == "__main__":
    init_database()
