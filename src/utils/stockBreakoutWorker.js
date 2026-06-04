const fs = require('fs');
const path = require('path');
const cron = require('node-cron');
const axios = require('axios');
const {
  upsertDailyPrices,
  getRecentPricesByTicker,
  getLowBaseBreakoutCandidates
} = require('./stockDb');
const { getLatestTaiwanMarketSnapshot } = require('./twMarketData');

const CHART_WINDOW = 80;
const DEFAULT_MIN_VOLUME = Number(process.env.TW_BREAKOUT_MIN_VOLUME || 1000);
const STRICT_LOOKBACK_DAYS = 30;
const FUNDAMENTAL_REQUEST_DELAY_MS = Number(process.env.TW_FUNDAMENTAL_DELAY_MS || 1200);
const FUNDAMENTAL_CACHE_TTL_MS = Number(process.env.TW_FUNDAMENTAL_CACHE_TTL_HOURS || 168) * 60 * 60 * 1000;
const FINMIND_API_URL = 'https://api.finmindtrade.com/api/v4/data';

let latestCache = null;
let isScanRunning = false;
let lastScanError = null;
let workerStarted = false;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isFinMindRateLimitError(error) {
  const status = Number(error?.response?.status || 0);
  const message = String(error?.message || '').toLowerCase();
  return status === 429 || status === 503 || message.includes('too many requests') || message.includes('429');
}

function resolveCachePath() {
  if (process.env.STOCK_CACHE_PATH) {
    return path.resolve(process.env.STOCK_CACHE_PATH);
  }
  return path.join(process.cwd(), 'data', 'stock_cache.json');
}

function resolveFundamentalCachePath() {
  if (process.env.STOCK_FUNDAMENTAL_CACHE_PATH) {
    return path.resolve(process.env.STOCK_FUNDAMENTAL_CACHE_PATH);
  }
  return path.join(process.cwd(), 'data', 'fundamental_cache.json');
}

function ensureCacheDir(cacheFilePath) {
  fs.mkdirSync(path.dirname(cacheFilePath), { recursive: true });
}

function saveCacheToFile(cache) {
  const cachePath = resolveCachePath();
  ensureCacheDir(cachePath);
  fs.writeFileSync(cachePath, JSON.stringify(cache, null, 2), 'utf8');
}

function loadCacheFromFile() {
  const cachePath = resolveCachePath();
  if (!fs.existsSync(cachePath)) return null;

  try {
    return JSON.parse(fs.readFileSync(cachePath, 'utf8'));
  } catch (error) {
    console.error('[twstock_breakout] 無法讀取快取檔案:', error);
    return null;
  }
}

function saveFundamentalCacheToFile(cacheMap) {
  const cachePath = resolveFundamentalCachePath();
  ensureCacheDir(cachePath);
  const payload = {
    updatedAt: new Date().toISOString(),
    byTicker: cacheMap
  };
  fs.writeFileSync(cachePath, JSON.stringify(payload, null, 2), 'utf8');
}

function loadFundamentalCacheFromFile() {
  const cachePath = resolveFundamentalCachePath();
  if (!fs.existsSync(cachePath)) return {};

  try {
    const parsed = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
    const byTicker = parsed?.byTicker;
    return byTicker && typeof byTicker === 'object' ? byTicker : {};
  } catch (error) {
    console.error('[twstock_breakout] 無法讀取基本面快取檔案:', error);
    return {};
  }
}

function calculateSMA(values, period = 20) {
  const result = Array(values.length).fill(null);
  let rollingSum = 0;

  for (let i = 0; i < values.length; i += 1) {
    rollingSum += values[i];
    if (i >= period) {
      rollingSum -= values[i - period];
    }

    if (i >= period - 1) {
      result[i] = rollingSum / period;
    }
  }

  return result;
}

function toFixed2(value) {
  return Number(Number(value).toFixed(2));
}

function toNullableNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function getTickerCode(ticker) {
  return String(ticker || '').replace(/\.(TW|TWO)$/i, '');
}

async function fetchFinMindData(dataset, tickerCode, startDate = '2018-01-01') {
  const response = await axios.get(FINMIND_API_URL, {
    timeout: 20000,
    params: {
      dataset,
      data_id: tickerCode,
      start_date: startDate
    }
  });

  const rows = Array.isArray(response?.data?.data) ? response.data.data : [];
  return rows;
}

function pickLatestByDate(items) {
  if (!Array.isArray(items) || items.length === 0) return null;
  return items
    .filter(item => item && item.date)
    .sort((a, b) => String(b.date).localeCompare(String(a.date)))[0] || null;
}

function extractLatestEps(financialRows) {
  const epsRows = (Array.isArray(financialRows) ? financialRows : [])
    .filter(row => {
      const type = String(row?.type || '').toUpperCase();
      const origin = String(row?.origin_name || '').toUpperCase();
      return type === 'EPS' || origin.includes('EPS');
    })
    .filter(row => toNullableNumber(row?.value) != null)
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));

  if (epsRows.length === 0) return null;
  return toNullableNumber(epsRows[0].value);
}

function extractLatestRevenueYoY(monthRevenueRows) {
  const rows = Array.isArray(monthRevenueRows) ? monthRevenueRows : [];
  const latest = pickLatestByDate(rows);
  if (!latest) return null;

  const candidateKeys = [
    'RevenueYearOnYearRatio',
    'revenue_year_on_year_ratio',
    'revenue_year_over_year',
    'month_price_compare_last_year',
    'YoY'
  ];

  for (const key of candidateKeys) {
    const n = toNullableNumber(latest?.[key]);
    if (n != null) return n;
  }

  // Fallback: compute YoY from latest month revenue vs same month last year.
  const latestRevenue = toNullableNumber(latest?.revenue);
  const latestMonth = Number(latest?.revenue_month);
  const latestYear = Number(latest?.revenue_year);

  if (latestRevenue == null || !Number.isFinite(latestMonth) || !Number.isFinite(latestYear)) {
    return null;
  }

  const previous = rows.find(item => {
    return Number(item?.revenue_month) === latestMonth && Number(item?.revenue_year) === (latestYear - 1);
  });

  const previousRevenue = toNullableNumber(previous?.revenue);
  if (previousRevenue == null || previousRevenue === 0) {
    return null;
  }

  return (latestRevenue - previousRevenue) / Math.abs(previousRevenue);

  return null;
}

async function fetchFundamentalMetrics(ticker) {
  const tickerCode = getTickerCode(ticker);
  const maxAttempts = 4;
  let sawRateLimit = false;

  if (!tickerCode) {
    return {
      symbol: null,
      trailingEps: null,
      revenueGrowth: null,
      margin: null,
      source: 'finmind-unavailable',
      rateLimited: false
    };
  }

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const [financialRows, monthRevenueRows] = await Promise.all([
        fetchFinMindData('TaiwanStockFinancialStatements', tickerCode),
        fetchFinMindData('TaiwanStockMonthRevenue', tickerCode)
      ]);

      const trailingEps = extractLatestEps(financialRows);
      const revenueGrowth = extractLatestRevenueYoY(monthRevenueRows);

      return {
        symbol: tickerCode,
        trailingEps,
        revenueGrowth,
        margin: null,
        source: 'finmind-live',
        rateLimited: false
      };
    } catch (error) {
      if (!isFinMindRateLimitError(error)) {
        break;
      }

      sawRateLimit = true;
      if (attempt >= maxAttempts) {
        break;
      }

      const backoffMs = 1000 * attempt;
      await sleep(backoffMs);
    }
  }

  return {
    symbol: null,
    trailingEps: null,
    revenueGrowth: null,
    margin: null,
    source: 'finmind-unavailable',
    rateLimited: sawRateLimit
  };
}

function hasUsableFundamentalMetrics(metrics) {
  return metrics?.trailingEps != null || metrics?.revenueGrowth != null || metrics?.margin != null;
}

function readFundamentalCacheEntry(cacheMap, ticker) {
  const entry = cacheMap?.[ticker];
  if (!entry) return null;

  const updatedAtMs = new Date(entry.updatedAt || 0).getTime();
  const isExpired = !Number.isFinite(updatedAtMs) || (Date.now() - updatedAtMs > FUNDAMENTAL_CACHE_TTL_MS);
  if (isExpired) return null;

  return {
    trailingEps: toNullableNumber(entry.trailingEps),
    revenueGrowth: toNullableNumber(entry.revenueGrowth),
    margin: toNullableNumber(entry.margin),
    symbol: entry.symbol || null,
    source: 'fundamental-cache',
    rateLimited: false
  };
}

function writeFundamentalCacheEntry(cacheMap, ticker, metrics) {
  cacheMap[ticker] = {
    updatedAt: new Date().toISOString(),
    symbol: metrics.symbol || null,
    trailingEps: metrics.trailingEps,
    revenueGrowth: metrics.revenueGrowth,
    margin: metrics.margin
  };
}

function evaluateFundamentalHealth(metrics) {
  const eps = metrics?.trailingEps;
  const revenueGrowth = metrics?.revenueGrowth;

  if (eps == null || revenueGrowth == null) {
    return {
      status: 'gray',
      color: '#808080',
      text: '基本面資料暫無'
    };
  }

  if (eps > 0 && revenueGrowth > 0) {
    return {
      status: 'green',
      color: '#00FF00',
      text: '✅ 最大優勢：獲利穩定且營收持續成長'
    };
  }

  if (eps <= 0 && revenueGrowth <= 0) {
    return {
      status: 'red',
      color: '#FF0000',
      text: '🚨 警訊：基本面偏弱，純屬技術面籌碼博弈'
    };
  }

  return {
    status: 'orange',
    color: '#FFA500',
    text: '⚠️ 狀態提醒：營收動能減緩或短期虧損，需觀察後續發酵'
  };
}

function buildChartSnapshot(rows, smaValues) {
  return {
    labels: rows.map(item => item.date),
    close: rows.map(item => toFixed2(item.close)),
    volume: rows.map(item => Number(item.volume || 0)),
    sma20: smaValues.map(value => (value == null ? null : toFixed2(value)))
  };
}

async function updateDailyPricesFromOfficialApis() {
  const snapshot = await getLatestTaiwanMarketSnapshot();
  if (snapshot.waiting || !snapshot.rows || snapshot.rows.length === 0) {
    const waitingError = new Error('Official market data is not published yet.');
    waitingError.code = 'MARKET_DATA_WAITING';
    waitingError.tradingDate = snapshot.tradingDate;
    throw waitingError;
  }

  upsertDailyPrices(snapshot.rows);
  return snapshot;
}

async function scanBreakoutStocks() {
  if (isScanRunning) return latestCache;

  isScanRunning = true;
  lastScanError = null;

  try {
    const minVolume = Number(process.env.TW_BREAKOUT_MIN_VOLUME || DEFAULT_MIN_VOLUME);
    const snapshot = await updateDailyPricesFromOfficialApis();
    const breakoutRows = getLowBaseBreakoutCandidates(snapshot.tradingDate, minVolume);

    const nameMap = new Map(snapshot.rows.map(item => [item.ticker, item.name]));
    const matchedStocks = [];
    const fundamentalCache = loadFundamentalCacheFromFile();

    for (const todayRow of breakoutRows) {
      const history = getRecentPricesByTicker(todayRow.ticker, CHART_WINDOW);
      if (history.length < 31) continue;

      const closes = history.map(item => Number(item.close));
      const sma20 = calculateSMA(closes, 20);
      const latestIndex = closes.length - 1;

      matchedStocks.push({
        symbol: todayRow.ticker,
        name: nameMap.get(todayRow.ticker) || todayRow.ticker,
        volume: Number(todayRow.volume || 0),
        lastClose: toFixed2(todayRow.close),
        sma20: toFixed2(todayRow.sma20),
        avgVolume30: Number(todayRow.avgVolume30 || 0),
        volumeRatio: Number(todayRow.volumeRatio || 0),
        breakoutTag: '30日首度突破',
        breakoutDate: history[latestIndex].date,
        chartSnapshot: buildChartSnapshot(history, sma20)
      });
    }

    matchedStocks.sort((a, b) => {
      if (b.volumeRatio !== a.volumeRatio) return b.volumeRatio - a.volumeRatio;
      return b.volume - a.volume;
    });

    // 僅對符合條件標的抓基本面，降低外部 API 壓力。
    for (const stock of matchedStocks) {
      const metrics = await fetchFundamentalMetrics(stock.symbol);
      const cachedMetrics = readFundamentalCacheEntry(fundamentalCache, stock.symbol);

      const finalMetrics = hasUsableFundamentalMetrics(metrics)
        ? metrics
        : (cachedMetrics || metrics);

      const health = evaluateFundamentalHealth(finalMetrics);

      if (hasUsableFundamentalMetrics(finalMetrics) && finalMetrics.source === 'finmind-live') {
        writeFundamentalCacheEntry(fundamentalCache, stock.symbol, finalMetrics);
      }

      stock.fundamentals = {
        trailingEps: finalMetrics.trailingEps,
        revenueGrowth: finalMetrics.revenueGrowth,
        margin: finalMetrics.margin
      };
      stock.healthStatus = health.status;
      stock.healthColor = health.color;
      stock.healthText = health.text;
      stock.fundamentalSource = finalMetrics.source;

      // 加入節流，降低 FinMind 未授權頻率限制風險。
      await sleep(FUNDAMENTAL_REQUEST_DELAY_MS);
    }

    saveFundamentalCacheToFile(fundamentalCache);

    latestCache = {
      updatedAt: new Date().toISOString(),
      timezone: 'Asia/Taipei',
      source: 'twse-mi_index+tpex-openapi-fallback',
      fullMarketMode: true,
      lookbackDays: STRICT_LOOKBACK_DAYS,
      strategyName: '低位爆量突破',
      strategyDescription: '前30日收盤皆低於SMA20，今日收盤站上SMA20，且量能超過前30日均量3倍。',
      volumeThreshold: minVolume,
      tradingDate: snapshot.tradingDate,
      sourceStockCount: breakoutRows.length,
      matchedCount: matchedStocks.length,
      matchedStocks
    };

    saveCacheToFile(latestCache);
    return latestCache;
  } catch (error) {
    lastScanError = error;
    console.error('[twstock_breakout] 預掃描失敗:', error);
    throw error;
  } finally {
    isScanRunning = false;
  }
}

function getStockBreakoutCache() {
  if (!latestCache) {
    latestCache = loadCacheFromFile();
  }

  return {
    cache: latestCache,
    isScanRunning,
    lastScanError,
    cachePath: resolveCachePath()
  };
}

async function bootstrapCacheIfNeeded() {
  const current = loadCacheFromFile();
  latestCache = current;

  if (!current) {
    await scanBreakoutStocks();
    return;
  }

  const cacheAge = Date.now() - new Date(current.updatedAt || 0).getTime();
  if (!Number.isFinite(cacheAge) || cacheAge > 24 * 60 * 60 * 1000) {
    await scanBreakoutStocks();
  }
}

function startStockBreakoutWorker() {
  if (workerStarted) return;
  workerStarted = true;

  bootstrapCacheIfNeeded().catch(error => {
    console.error('[twstock_breakout] 啟動初始化失敗:', error?.message || error);
  });

  cron.schedule('0 17 * * *', () => {
    scanBreakoutStocks().catch(error => {
      console.error('[twstock_breakout] 每日排程執行失敗:', error?.message || error);
    });
  }, {
    timezone: 'Asia/Taipei'
  });

  console.log('[twstock_breakout] 背景預掃描已啟用（每日 17:00 Asia/Taipei）');
}

module.exports = {
  startStockBreakoutWorker,
  getStockBreakoutCache,
  scanBreakoutStocks
};
