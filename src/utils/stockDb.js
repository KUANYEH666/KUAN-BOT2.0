const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

let dbInstance = null;

function resolveDbPath() {
  if (process.env.TWSTOCK_DB_PATH) {
    return path.resolve(process.env.TWSTOCK_DB_PATH);
  }
  return path.join(process.cwd(), 'data', 'twstock.db');
}

function ensureDbDirectory(dbPath) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
}

function getDb() {
  if (dbInstance) return dbInstance;

  const dbPath = resolveDbPath();
  ensureDbDirectory(dbPath);
  dbInstance = new Database(dbPath);
  dbInstance.pragma('journal_mode = WAL');

  dbInstance.exec(`
    CREATE TABLE IF NOT EXISTS daily_prices (
      ticker TEXT NOT NULL,
      date TEXT NOT NULL,
      close REAL NOT NULL,
      volume REAL NOT NULL,
      PRIMARY KEY (ticker, date)
    );

    CREATE INDEX IF NOT EXISTS idx_daily_prices_ticker_date
      ON daily_prices (ticker, date DESC);
  `);

  return dbInstance;
}

function closeDb() {
  if (!dbInstance) return;
  dbInstance.close();
  dbInstance = null;
}

function upsertDailyPrices(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return 0;

  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO daily_prices (ticker, date, close, volume)
    VALUES (@ticker, @date, @close, @volume)
    ON CONFLICT(ticker, date)
    DO UPDATE SET
      close = excluded.close,
      volume = excluded.volume
  `);

  const tx = db.transaction((items) => {
    for (const item of items) {
      stmt.run({
        ticker: item.ticker,
        date: item.date,
        close: Number(item.close),
        volume: Number(item.volume || 0)
      });
    }
  });

  tx(rows);
  return rows.length;
}

function getLatestRowsByDate(date, minVolume = 0) {
  const db = getDb();
  return db.prepare(`
    SELECT ticker, date, close, volume
    FROM daily_prices
    WHERE date = ? AND volume > ?
    ORDER BY volume DESC
  `).all(date, Number(minVolume || 0));
}

function getRecentPricesByTicker(ticker, limit = 60) {
  const db = getDb();
  const rows = db.prepare(`
    SELECT ticker, date, close, volume
    FROM daily_prices
    WHERE ticker = ?
    ORDER BY date DESC
    LIMIT ?
  `).all(ticker, limit);

  return rows.reverse();
}

function getTickerCountWithMinBars(minBars) {
  const db = getDb();
  return db.prepare(`
    SELECT COUNT(*) AS count
    FROM (
      SELECT ticker
      FROM daily_prices
      GROUP BY ticker
      HAVING COUNT(*) >= ?
    )
  `).get(Number(minBars || 0)).count;
}

function getDistinctTickersByDate(date) {
  if (!date) return [];

  const db = getDb();
  const rows = db.prepare(`
    SELECT DISTINCT ticker
    FROM daily_prices
    WHERE date = ?
    ORDER BY ticker ASC
  `).all(date);

  return rows.map(row => row.ticker).filter(Boolean);
}

function getLowBaseBreakoutCandidates(tradingDate, minVolume = 0) {
  const db = getDb();

  return db.prepare(`
    WITH ranked AS (
      SELECT
        ticker,
        date,
        close,
        volume,
        ROW_NUMBER() OVER (
          PARTITION BY ticker
          ORDER BY date
        ) AS rn,
        AVG(close) OVER (
          PARTITION BY ticker
          ORDER BY date
          ROWS BETWEEN 19 PRECEDING AND CURRENT ROW
        ) AS sma20,
        AVG(volume) OVER (
          PARTITION BY ticker
          ORDER BY date
          ROWS BETWEEN 30 PRECEDING AND 1 PRECEDING
        ) AS avg_vol_prev30,
        COUNT(*) OVER (
          PARTITION BY ticker
          ORDER BY date
          ROWS BETWEEN 30 PRECEDING AND 1 PRECEDING
        ) AS cnt_prev30,
        COUNT(*) OVER (
          PARTITION BY ticker
        ) AS total_bars
      FROM daily_prices
    ),
    today_rows AS (
      SELECT *
      FROM ranked
      WHERE date = @tradingDate
        AND volume > @minVolume
    ),
    prev30_check AS (
      SELECT
        t.ticker,
        COUNT(*) AS prev30_count,
        SUM(
          CASE
            WHEN p.sma20 IS NOT NULL AND p.close < p.sma20 THEN 1
            ELSE 0
          END
        ) AS prev30_below_sma20_count
      FROM today_rows t
      JOIN ranked p
        ON p.ticker = t.ticker
       AND p.rn BETWEEN t.rn - 30 AND t.rn - 1
      GROUP BY t.ticker
    )
    SELECT
      t.ticker,
      t.date,
      ROUND(t.close, 2) AS close,
      ROUND(t.sma20, 2) AS sma20,
      CAST(t.volume AS INTEGER) AS volume,
      ROUND(t.avg_vol_prev30, 1) AS avgVolume30,
      ROUND(t.volume / NULLIF(t.avg_vol_prev30, 0), 1) AS volumeRatio,
      t.total_bars AS totalBars
    FROM today_rows t
    JOIN prev30_check c
      ON c.ticker = t.ticker
    WHERE
      t.total_bars >= 31
      AND t.cnt_prev30 = 30
      AND c.prev30_count = 30
      AND c.prev30_below_sma20_count = 30
      AND t.sma20 IS NOT NULL
      AND t.close > t.sma20
      AND t.avg_vol_prev30 IS NOT NULL
      AND t.volume > t.avg_vol_prev30 * 3.0
    ORDER BY volumeRatio DESC, t.volume DESC
  `).all({
    tradingDate,
    minVolume: Number(minVolume || 0)
  });
}

module.exports = {
  getDb,
  closeDb,
  resolveDbPath,
  upsertDailyPrices,
  getLatestRowsByDate,
  getRecentPricesByTicker,
  getTickerCountWithMinBars,
  getDistinctTickersByDate,
  getLowBaseBreakoutCandidates
};
