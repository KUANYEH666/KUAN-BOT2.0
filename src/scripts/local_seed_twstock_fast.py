#!/usr/bin/env python3
import concurrent.futures
import datetime as dt
import json
import os
import sqlite3
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

TWSE_MI_INDEX_URL = "https://www.twse.com.tw/exchangeReport/MI_INDEX"
TPEX_OPENAPI_URL = "https://www.tpex.org.tw/openapi/v1/tpex_mainboard_quotes"
YAHOO_CHART_URL = "https://query1.finance.yahoo.com/v8/finance/chart/{symbol}"

HEADERS = {
    "Accept": "application/json,text/plain,*/*",
    "User-Agent": "Mozilla/5.0",
}

LOOKBACK_DAYS = int(os.getenv("PY_SEED_LOOKBACK_DAYS", "180"))
TARGET_BARS = int(os.getenv("PY_SEED_TARGET_BARS", "50"))
CONCURRENCY = max(1, int(os.getenv("PY_SEED_CONCURRENCY", "12")))
TIMEOUT = int(os.getenv("PY_SEED_TIMEOUT", "20"))
MAX_TICKERS = int(os.getenv("PY_SEED_MAX_TICKERS", "0"))
PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
DB_PATH = os.path.abspath(os.getenv("TWSTOCK_DB_PATH", os.path.join(PROJECT_ROOT, "data", "twstock.db")))

state_lock = threading.Lock()
progress = {"checked": 0, "success": 0, "failed": 0, "upserted": 0, "total": 0}


def to_number(value):
    if value is None:
        return 0.0
    text = str(value).replace(",", "").replace("--", "").strip()
    try:
        return float(text)
    except ValueError:
        return 0.0


def fetch_json(url, params):
    query = urllib.parse.urlencode(params)
    full_url = f"{url}?{query}" if query else url
    req = urllib.request.Request(full_url, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
        raw = resp.read().decode("utf-8", errors="replace")
    return json.loads(raw)


def fetch_twse_tickers():
    for back in range(0, 7):
        day = dt.date.today() - dt.timedelta(days=back)
        try:
            payload = fetch_json(
                TWSE_MI_INDEX_URL,
                {
                    "response": "json",
                    "date": day.strftime("%Y%m%d"),
                    "type": "ALLBUT0999",
                },
            )
        except Exception:
            continue

        if "OK" not in str(payload.get("stat", "")):
            continue

        tables = payload.get("tables") or []
        table = None
        for t in tables:
            fields = t.get("fields") or []
            if "證券代號" in fields and "收盤價" in fields:
                table = t
                break
        if not table:
            continue

        fields = table.get("fields") or []
        rows = table.get("data") or []
        code_i = fields.index("證券代號")
        close_i = fields.index("收盤價")

        out = []
        for r in rows:
            code = str(r[code_i]).strip()
            close = to_number(r[close_i])
            if code.isdigit() and 4 <= len(code) <= 6 and close > 0:
                out.append(f"{code}.TW")
        if out:
            return out
    return []


def fetch_tpex_tickers():
    try:
        payload = fetch_json(TPEX_OPENAPI_URL, {})
    except Exception:
        return []

    out = []
    rows = payload if isinstance(payload, list) else []
    for row in rows:
        code = str(row.get("SecuritiesCompanyCode", "")).strip()
        close = to_number(row.get("Close"))
        if code and 4 <= len(code) <= 6 and close > 0:
            out.append(f"{code}.TWO")
    return out


def get_universe():
    tickers = sorted(set(fetch_twse_tickers() + fetch_tpex_tickers()))
    if MAX_TICKERS > 0:
        return tickers[:MAX_TICKERS]
    return tickers


def candidate_symbols(ticker):
    if ticker.endswith(".TW"):
        return [ticker, ticker.replace(".TW", ".TWO")]
    if ticker.endswith(".TWO"):
        return [ticker, ticker.replace(".TWO", ".TW")]
    return [ticker]


def fetch_history(symbol):
    period1 = int(time.time() - LOOKBACK_DAYS * 24 * 60 * 60)
    period2 = int(time.time())

    payload = fetch_json(
        YAHOO_CHART_URL.format(symbol=urllib.parse.quote(symbol)),
        {
            "interval": "1d",
            "period1": str(period1),
            "period2": str(period2),
            "events": "history",
        },
    )

    result = (((payload.get("chart") or {}).get("result") or [None])[0])
    if not result:
        return []

    ts = result.get("timestamp") or []
    quote = (((result.get("indicators") or {}).get("quote") or [{}])[0])
    closes = quote.get("close") or []
    volumes = quote.get("volume") or []

    rows = []
    for i, t in enumerate(ts):
        if i >= len(closes):
            continue
        c = closes[i]
        if c is None:
            continue
        v = 0.0 if i >= len(volumes) or volumes[i] is None else float(volumes[i])
        d = dt.datetime.utcfromtimestamp(t).strftime("%Y-%m-%d")
        rows.append((d, float(c), v))
    return rows


def fetch_ticker_rows(ticker):
    for symbol in candidate_symbols(ticker):
        for attempt in range(1, 5):
            try:
                rows = fetch_history(symbol)
                if len(rows) >= TARGET_BARS:
                    return [(ticker, d, c, v) for d, c, v in rows]
                break
            except urllib.error.HTTPError as e:
                if e.code != 429:
                    break
                time.sleep(0.8 * attempt)
            except Exception:
                break
    return []


def ensure_db():
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    try:
        conn.execute("PRAGMA journal_mode=WAL;")
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS daily_prices (
                ticker TEXT NOT NULL,
                date TEXT NOT NULL,
                close REAL NOT NULL,
                volume REAL NOT NULL,
                PRIMARY KEY (ticker, date)
            );
            CREATE INDEX IF NOT EXISTS idx_daily_prices_ticker_date
            ON daily_prices (ticker, date DESC);
            """
        )
        conn.commit()
    finally:
        conn.close()


def upsert_rows(rows):
    if not rows:
        return 0
    conn = sqlite3.connect(DB_PATH, timeout=30)
    try:
        conn.executemany(
            """
            INSERT INTO daily_prices (ticker, date, close, volume)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(ticker, date)
            DO UPDATE SET close=excluded.close, volume=excluded.volume
            """,
            rows,
        )
        conn.commit()
        return len(rows)
    finally:
        conn.close()


def work_one(ticker):
    rows = fetch_ticker_rows(ticker)
    changed = upsert_rows(rows)

    with state_lock:
        progress["checked"] += 1
        if rows:
            progress["success"] += 1
            progress["upserted"] += changed
        else:
            progress["failed"] += 1

        if progress["checked"] % 50 == 0:
            print(
                f"[py-seed] Progress {progress['checked']}/{progress['total']} "
                f"(success: {progress['success']}, failed: {progress['failed']}, upserted: {progress['upserted']})"
            )


def main():
    start = time.time()
    universe = get_universe()
    progress["total"] = len(universe)

    print(f"[py-seed] Universe size: {progress['total']}")
    print(f"[py-seed] DB path: {DB_PATH}")
    print(f"[py-seed] Concurrency: {CONCURRENCY}")
    print(f"[py-seed] Lookback days: {LOOKBACK_DAYS}, Target bars: {TARGET_BARS}")

    if not universe:
        print("[py-seed] No tickers found.")
        return 1

    ensure_db()

    with concurrent.futures.ThreadPoolExecutor(max_workers=CONCURRENCY) as ex:
        futures = [ex.submit(work_one, t) for t in universe]
        for f in concurrent.futures.as_completed(futures):
            _ = f.result()

    elapsed = time.time() - start
    print("[py-seed] Completed.")
    print(
        f"[py-seed] checked={progress['checked']} success={progress['success']} "
        f"failed={progress['failed']} upserted={progress['upserted']}"
    )
    print(f"[py-seed] elapsed={elapsed:.1f}s")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
