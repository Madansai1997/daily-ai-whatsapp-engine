"""
aiosqlite/sqlite3-compatible shim, so the ~91 existing DB call sites across this app
need zero changes — only `import aiosqlite` -> `import db_compat as aiosqlite` and the
sync `sqlite3.connect(...)` lines in each file's init function need swapping.

Dual mode, selected by TURSO_DATABASE_URL:
- Unset (local dev/testing): delegates straight to the real aiosqlite/sqlite3 modules
  against the local file. Zero behavior change, no network dependency.
- Set (Render production): talks directly to Turso's HTTP API. Deliberately bypasses
  the official `libsql_client` PyPI package — it has a confirmed bug against Turso's
  current server: it only checks the HTTP status code to detect errors, but Turso
  returns statement-level errors (e.g. constraint violations) as HTTP 200 with a
  {"message", "code"} body instead of {"result"}, which crashes that library with a
  raw KeyError('result') instead of raising properly. Calling the HTTP API directly
  with httpx (already a dependency) sidesteps this entirely and is simpler.
"""
import os
import sqlite3 as _sqlite3

TURSO_URL = os.environ.get("TURSO_DATABASE_URL", "").replace("libsql://", "https://").rstrip("/")
TURSO_TOKEN = os.environ.get("TURSO_AUTH_TOKEN")
USE_TURSO = bool(TURSO_URL)

if not USE_TURSO:
    import aiosqlite as _aiosqlite

    Row = _aiosqlite.Row
    connect = _aiosqlite.connect

    def connect_sync(db_path, check_same_thread=False):
        return _sqlite3.connect(db_path, check_same_thread=check_same_thread)

else:
    import httpx

    _EXECUTE_PATH = "/v1/execute"
    _HEADERS = {"authorization": f"Bearer {TURSO_TOKEN}"}

    class Row:
        """Sentinel: assign conn.row_factory = Row to get dict-like rows, mirroring aiosqlite.Row."""
        pass

    def _encode_args(params):
        encoded = []
        for v in (params or []):
            if v is None:
                encoded.append({"type": "null"})
            elif isinstance(v, bool):
                encoded.append({"type": "integer", "value": str(int(v))})
            elif isinstance(v, int):
                encoded.append({"type": "integer", "value": str(v)})
            elif isinstance(v, float):
                encoded.append({"type": "float", "value": v})
            else:
                encoded.append({"type": "text", "value": str(v)})
        return encoded

    def _decode_cell(cell):
        t = cell.get("type")
        if t == "null":
            return None
        if t == "integer":
            return int(cell["value"])
        if t == "float":
            return float(cell["value"])
        return cell.get("value")

    def _build_body(sql, params):
        return {"stmt": {"sql": sql, "args": _encode_args(params), "named_args": [], "want_rows": True}}

    def _handle_response(body):
        """Returns (cols, rows, last_insert_rowid) on success; raises on a statement-level error.
        Turso signals statement errors via HTTP 200 with no "result" key — never via HTTP status."""
        if "result" not in body:
            message = body.get("message", "Unknown Turso error")
            code = body.get("code", "UNKNOWN")
            if code == "SQLITE_CONSTRAINT" and "UNIQUE" in message.upper():
                raise _sqlite3.IntegrityError(message)
            raise RuntimeError(f"{code}: {message}")
        result = body["result"]
        cols = [c["name"] for c in result.get("cols", [])]
        rows = result.get("rows", [])
        last_insert_rowid = result.get("last_insert_rowid")
        return cols, rows, int(last_insert_rowid) if last_insert_rowid is not None else None

    class _AsyncCursor:
        def __init__(self, cols, rows, lastrowid, row_factory):
            self._cols = cols
            self._rows = rows
            self.lastrowid = lastrowid
            self._row_factory = row_factory
            self._pos = 0

        def _materialize(self, raw_row):
            values = [_decode_cell(c) for c in raw_row]
            if self._row_factory is Row:
                return dict(zip(self._cols, values))
            return tuple(values)

        async def fetchone(self):
            if self._pos >= len(self._rows):
                return None
            row = self._materialize(self._rows[self._pos])
            self._pos += 1
            return row

        async def fetchall(self):
            rows = [self._materialize(r) for r in self._rows[self._pos:]]
            self._pos = len(self._rows)
            return rows

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

    _async_client = None

    def _get_async_client():
        global _async_client
        if _async_client is None:
            _async_client = httpx.AsyncClient(headers=_HEADERS, timeout=15.0)
        return _async_client

    class _ExecuteAwaitable:
        """Mirrors aiosqlite's trick: the object returned by execute() must support both
        `cur = await db.execute(...)` and `async with db.execute(...) as cur:` — a plain
        coroutine only supports the former."""
        def __init__(self, coro):
            self._coro = coro

        def __await__(self):
            return self._coro.__await__()

        async def __aenter__(self):
            self._cursor = await self._coro
            return self._cursor

        async def __aexit__(self, exc_type, exc, tb):
            return False

    class TursoConnection:
        def __init__(self):
            self.row_factory = None

        def execute(self, sql, params=None):
            return _ExecuteAwaitable(self._execute(sql, params))

        async def _execute(self, sql, params=None):
            resp = await _get_async_client().post(f"{TURSO_URL}{_EXECUTE_PATH}", json=_build_body(sql, params))
            cols, rows, lastrowid = _handle_response(resp.json())
            return _AsyncCursor(cols, rows, lastrowid, self.row_factory)

        async def commit(self):
            pass  # every execute() is independently committed server-side; no call site
                  # in this app relies on cross-statement atomicity (confirmed during migration)

        async def close(self):
            pass  # underlying httpx client is a shared, long-lived singleton — don't tear it down

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            await self.close()

    def connect(db_path_ignored=None):
        return TursoConnection()

    class _SyncCursor:
        def __init__(self, cols, rows, lastrowid, row_factory):
            self._cols = cols
            self._rows = rows
            self.lastrowid = lastrowid
            self._row_factory = row_factory

        def _materialize(self, raw_row):
            values = [_decode_cell(c) for c in raw_row]
            if self._row_factory is Row:
                return dict(zip(self._cols, values))
            return tuple(values)

        def fetchone(self):
            return self._materialize(self._rows[0]) if self._rows else None

        def fetchall(self):
            return [self._materialize(r) for r in self._rows]

    _sync_client = None

    def _get_sync_client():
        global _sync_client
        if _sync_client is None:
            _sync_client = httpx.Client(headers=_HEADERS, timeout=15.0)
        return _sync_client

    class TursoConnectionSync:
        """Acts as both Connection and Cursor — conn.cursor() returns self, and conn.execute(...)
        is chainable with .fetchone()/.fetchall(), matching both sync usage patterns in this app
        (cursor=conn.cursor();cursor.execute(...) in init_*_tables(), and
        conn.execute(...).fetchone() in V3_updates._get_db_conn())."""
        def __init__(self):
            self.row_factory = None

        def cursor(self):
            return self

        def execute(self, sql, params=None):
            resp = _get_sync_client().post(f"{TURSO_URL}{_EXECUTE_PATH}", json=_build_body(sql, params))
            cols, rows, lastrowid = _handle_response(resp.json())
            return _SyncCursor(cols, rows, lastrowid, self.row_factory)

        def commit(self):
            pass

        def close(self):
            pass  # shared singleton client — never torn down per-connection

    def connect_sync(db_path_ignored=None, check_same_thread=False):
        return TursoConnectionSync()
