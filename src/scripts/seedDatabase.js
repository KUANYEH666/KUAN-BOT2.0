require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });

const yahooFinance = require('yahoo-finance2').default;
const pLimit = require('p-limit');
const { getTaiwanTickerUniverse } = require('../utils/twMarketData');
const { getDb, closeDb, upsertDailyPrices, resolveDbPath } = require('../utils/stockDb');

yahooFinance.suppressNotices(['yahooSurvey', 'ripHistorical']);

const LOOKBACK_DAYS = Number(process.env.SEED_LOOKBACK_DAYS || 120);
const TARGET_BARS = Number(process.env.SEED_TARGET_BARS || 50);
const CONCURRENCY = Number(process.env.SEED_CONCURRENCY || 1);
const REQUEST_DELAY_MS = Number(process.env.SEED_REQUEST_DELAY_MS || 250);
const MAX_TICKERS = Number(process.env.SEED_MAX_TICKERS || 0);

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isRateLimitError(error) {
  const message = String(error?.message || '').toLowerCase();
  return error?.statusCode === 429 || message.includes('too many requests') || message.includes('429');
}

function toIsoDate(dateValue) {
  return new Date(dateValue).toISOString().slice(0, 10);
}

function candidateSymbols(ticker) {
  if (ticker.endsWith('.TW')) {
    return [ticker, ticker.replace('.TW', '.TWO')];
  }
  if (ticker.endsWith('.TWO')) {
    return [ticker, ticker.replace('.TWO', '.TW')];
  }
  return [ticker];
}

async function fetchHistoryForTicker(ticker) {
  const candidates = candidateSymbols(ticker);
  const period1 = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);

  for (const symbol of candidates) {
    const maxAttempts = 5;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const chart = await yahooFinance.chart(symbol, {
          period1,
          interval: '1d'
        });

        const rows = Array.isArray(chart?.quotes) ? chart.quotes : [];

        const normalized = rows
          .filter(item => item?.date && item?.close != null)
          .map(item => ({
            ticker,
            date: toIsoDate(item.date),
            close: Number(item.close),
            volume: Number(item.volume || 0)
          }));

        if (normalized.length >= TARGET_BARS) {
          if (REQUEST_DELAY_MS > 0) {
            await sleep(REQUEST_DELAY_MS);
          }
          return normalized;
        }

        break;
      } catch (error) {
        if (!isRateLimitError(error)) {
          break;
        }

        if (attempt >= maxAttempts) {
          break;
        }

        const backoff = 800 * attempt;
        await sleep(backoff);
      }
    }
  }

  return [];
}

async function run() {
  getDb();

  const universe = await getTaiwanTickerUniverse();
  const allTickers = universe.map(item => item.ticker);
  const tickers = MAX_TICKERS > 0 ? allTickers.slice(0, MAX_TICKERS) : allTickers;
  console.log(`[seed] Universe size: ${tickers.length}`);
  console.log(`[seed] DB path: ${resolveDbPath()}`);
  console.log(`[seed] Concurrency: ${CONCURRENCY}, Delay(ms): ${REQUEST_DELAY_MS}`);

  const limit = pLimit(Math.max(1, CONCURRENCY));

  let successTickers = 0;
  let failedTickers = 0;
  let insertedRows = 0;
  let checked = 0;

  await Promise.all(
    tickers.map(ticker => limit(async () => {
      const history = await fetchHistoryForTicker(ticker);
      checked += 1;

      if (history.length === 0) {
        failedTickers += 1;
        if (checked % 100 === 0) {
          console.log(`[seed] Progress ${checked}/${tickers.length} (success: ${successTickers}, failed: ${failedTickers})`);
        }
        return;
      }

      insertedRows += upsertDailyPrices(history);
      successTickers += 1;

      if (checked % 100 === 0) {
        console.log(`[seed] Progress ${checked}/${tickers.length} (success: ${successTickers}, failed: ${failedTickers})`);
      }
    }))
  );

  console.log('[seed] Completed.');
  console.log(`[seed] Success tickers: ${successTickers}`);
  console.log(`[seed] Failed tickers: ${failedTickers}`);
  console.log(`[seed] Upsert rows: ${insertedRows}`);
}

run()
  .catch(error => {
    console.error('[seed] Failed:', error);
    process.exitCode = 1;
  })
  .finally(() => {
    closeDb();
  });
