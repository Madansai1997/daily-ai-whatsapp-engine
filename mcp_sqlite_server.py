#!/usr/bin/env python3
"""
SQLite MCP Server
Exposes tools to inspect tables, describe schema, and run queries against agent_memory.db.
"""

import os
import sys
# Load .env BEFORE importing db_compat — db_compat picks Turso-vs-local at import time from
# TURSO_DATABASE_URL, so without this the MCP process falls back to the stale local SQLite file
# instead of the production Turso DB that Render uses.
from dotenv import load_dotenv
load_dotenv()
from mcp.server.fastmcp import FastMCP
import db_compat as aiosqlite

# Writes are OFF by default so this inspection tool can't accidentally mutate production.
# Set MCP_ALLOW_WRITE=1 in the server's environment to enable execute_write for a session.
_ALLOW_WRITE = os.environ.get("MCP_ALLOW_WRITE", "").strip().lower() in ("1", "true", "on", "yes")

# Resolve DB path consistent with the rest of the application
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.environ.get("DB_PATH", os.path.join(BASE_DIR, "agent_memory.db"))

mcp = FastMCP("SQLite-Local-Server")

@mcp.tool()
def list_tables() -> str:
    """List all tables in the SQLite database."""
    try:
        conn = aiosqlite.connect_sync(DB_PATH)
        # conn.execute(...) returns a cursor with results for BOTH sqlite3 and db_compat's
        # Turso connection — conn.cursor()+fetchall() only works for local sqlite3.
        raw_rows = conn.execute("SELECT name FROM sqlite_master WHERE type='table';").fetchall()
        conn.close()
        
        tables = []
        for r in raw_rows:
            if isinstance(r, dict):
                tables.append(list(r.values())[0])
            else:
                tables.append(r[0])
                
        return "Tables in database:\n" + "\n".join(f"- {t}" for t in tables)
    except Exception as e:
        return f"Error listing tables: {str(e)}"

@mcp.tool()
def describe_table(table_name: str) -> str:
    """Get the schema and column info for a specific table."""
    try:
        # Validate table name to prevent basic SQL injection attempts
        clean_name = "".join(c for c in table_name if c.isalnum() or c == "_")
        if not clean_name:
            return "Error: Invalid table name provided."
            
        conn = aiosqlite.connect_sync(DB_PATH)
        raw_rows = conn.execute(f"PRAGMA table_info({clean_name});").fetchall()
        conn.close()
        
        if not raw_rows:
            return f"Table '{table_name}' not found or has no columns."
        
        lines = []
        for row in raw_rows:
            if isinstance(row, dict):
                col_name = row.get("name")
                col_type = row.get("type")
                pk = bool(row.get("pk"))
                notnull = bool(row.get("notnull"))
            else:
                col_name = row[1]
                col_type = row[2]
                notnull = bool(row[3])
                pk = bool(row[5])
            lines.append(f"Column: {col_name} ({col_type}) | PK: {pk} | NotNull: {notnull}")
        return f"Schema for {table_name}:\n" + "\n".join(lines)
    except Exception as e:
        return f"Error describing table '{table_name}': {str(e)}"

@mcp.tool()
def execute_query(sql_query: str) -> str:
    """Execute a read-only SELECT query on the database and return formatted rows."""
    query_upper = sql_query.upper().strip()
    # Permit SELECT, WITH, and PRAGMA queries
    if not (query_upper.startswith("SELECT") or query_upper.startswith("WITH") or query_upper.startswith("PRAGMA")):
        return "Error: Only read-only (SELECT, WITH, PRAGMA) statements are allowed in execute_query. Use execute_write for modifications."
        
    try:
        conn = aiosqlite.connect_sync(DB_PATH)
        conn.row_factory = aiosqlite.Row
        rows = conn.execute(sql_query).fetchall()
        conn.close()
        
        if not rows:
            return "Query executed successfully. No rows returned."
            
        # Format rows output nicely
        if hasattr(rows[0], "keys"):
            keys = list(rows[0].keys())
            header = " | ".join(keys)
            separator = "-+-".join("-" * max(len(str(k)), 1) for k in keys)
            data_lines = []
            for r in rows:
                data_lines.append(" | ".join(str(r[k]) for k in keys))
            return f"Query Results:\n{header}\n{separator}\n" + "\n".join(data_lines)
        else:
            header = " | ".join(f"Col {i}" for i in range(len(rows[0])))
            separator = "-+-".join("-----" for _ in range(len(rows[0])))
            data_lines = []
            for r in rows:
                data_lines.append(" | ".join(str(val) for val in r))
            return f"Query Results:\n{header}\n{separator}\n" + "\n".join(data_lines)
    except Exception as e:
        return f"Error executing query: {str(e)}"

@mcp.tool()
def execute_write(sql_statement: str) -> str:
    """Execute a database modification statement (INSERT, UPDATE, DELETE)."""
    if not _ALLOW_WRITE:
        return ("Writes are disabled (read-only mode). This server targets the PRODUCTION Turso "
                "database — set MCP_ALLOW_WRITE=1 in the server environment to enable "
                "INSERT/UPDATE/DELETE, then reconnect.")
    try:
        conn = aiosqlite.connect_sync(DB_PATH)
        conn.execute(sql_statement)
        conn.commit()
        changes = getattr(conn, "total_changes", None)
        conn.close()
        suffix = f" Total changes: {changes}" if changes is not None else ""
        return f"Statement executed successfully.{suffix}"
    except Exception as e:
        return f"Error executing write statement: {str(e)}"

if __name__ == "__main__":
    mcp.run()
