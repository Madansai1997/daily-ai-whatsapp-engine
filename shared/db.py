import os
import aiosqlite

DB_PATH = os.environ.get("DB_PATH", "agent_memory.db")


async def get_db():
    """Returns an open aiosqlite connection to DB_PATH. Caller is responsible for closing it."""
    return await aiosqlite.connect(DB_PATH)


async def execute_query(query: str, params: tuple = ()):
    """Runs a single query (commits if it's a write) and returns the cursor."""
    async with aiosqlite.connect(DB_PATH) as db:
        cursor = await db.execute(query, params)
        await db.commit()
        return cursor
