import sqlite3

def init_database():
    DB_PATH = "/Users/madansaidaram/Desktop/Daily_AI_updates/agent_memory.db"
    
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
    
    cursor.execute("INSERT OR IGNORE INTO user_profile (key, value) VALUES ('skill_level', 'Intermediate')")
    conn.commit()
    conn.close()
    print(f"💾 Database initialized successfully at: {DB_PATH}")

if __name__ == "__main__":
    init_database()
