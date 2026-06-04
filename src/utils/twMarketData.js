const TWSE_MI_INDEX_URL = 'https://www.twse.com.tw/exchangeReport/MI_INDEX';
const TPEX_QUOTES_URL = 'https://www.tpex.org.tw/web/stock/aftertrading/otc_quotes_no1430/stk_quotedtl_result.php';
const TPEX_MAINBOARD_OPENAPI_URL = 'https://www.tpex.org.tw/openapi/v1/tpex_mainboard_quotes';

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function toNumber(value) {
  if (value == null) return 0;
  const text = String(value).replace(/,/g, '').replace(/--/g, '').trim();
  const n = Number(text);
  return Number.isFinite(n) ? n : 0;
}

function toIsoDate(dateObj) {
  const y = dateObj.getFullYear();
  const m = String(dateObj.getMonth() + 1).padStart(2, '0');
  const d = String(dateObj.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function toTwseDate(dateObj) {
  const y = dateObj.getFullYear();
  const m = String(dateObj.getMonth() + 1).padStart(2, '0');
  const d = String(dateObj.getDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

function toTpexRocDate(dateObj) {
  const y = dateObj.getFullYear() - 1911;
  const m = String(dateObj.getMonth() + 1).padStart(2, '0');
  const d = String(dateObj.getDate()).padStart(2, '0');
  return `${y}/${m}/${d}`;
}

async function fetchJsonWithRetry(url, params) {
  const maxAttempts = 3;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const search = new URLSearchParams(params).toString();
      const response = await fetch(`${url}?${search}`, {
        headers: {
          accept: 'application/json,text/plain,*/*',
          'user-agent': 'Mozilla/5.0'
        }
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const body = await response.text();
      try {
        return JSON.parse(body);
      } catch {
        const snippet = body.slice(0, 120).replace(/\s+/g, ' ');
        throw new Error(`Non-JSON response: ${snippet}`);
      }
    } catch (error) {
      if (attempt >= maxAttempts) throw error;
      await sleep(500 * attempt);
    }
  }

  return null;
}

function findTwseStockTable(payload) {
  const tables = Array.isArray(payload?.tables) ? payload.tables : [];
  return tables.find(table => {
    const fields = Array.isArray(table?.fields) ? table.fields : [];
    return fields.includes('證券代號') && fields.includes('證券名稱') && fields.includes('成交股數') && fields.includes('收盤價');
  }) || null;
}

function parseTwseRows(payload, dateObj) {
  const stat = String(payload?.stat || '');
  if (!stat.includes('OK')) {
    return [];
  }

  const table = findTwseStockTable(payload);
  if (!table) return [];

  const fields = table.fields;
  const rows = Array.isArray(table.data) ? table.data : [];

  const codeIdx = fields.indexOf('證券代號');
  const nameIdx = fields.indexOf('證券名稱');
  const closeIdx = fields.indexOf('收盤價');
  const volumeIdx = fields.indexOf('成交股數');

  if ([codeIdx, nameIdx, closeIdx, volumeIdx].some(idx => idx < 0)) {
    return [];
  }

  const date = toIsoDate(dateObj);
  return rows
    .map(cols => ({
      code: String(cols[codeIdx] || '').trim(),
      name: String(cols[nameIdx] || '').trim(),
      close: toNumber(cols[closeIdx]),
      volume: toNumber(cols[volumeIdx])
    }))
    .filter(item => /^\d{4,6}$/.test(item.code) && item.close > 0)
    .map(item => ({
      ticker: `${item.code}.TW`,
      name: item.name || item.code,
      date,
      close: item.close,
      volume: item.volume
    }));
}

function parseTpexRows(payload, dateObj) {
  const aaData = Array.isArray(payload?.aaData) ? payload.aaData : [];
  if (aaData.length === 0) return [];

  const date = toIsoDate(dateObj);

  return aaData
    .map(cols => {
      const code = String(cols?.[0] || '').trim();
      const name = String(cols?.[1] || '').trim();
      const close = toNumber(cols?.[2]);
      const volume = toNumber(cols?.[8]);

      return {
        ticker: `${code}.TWO`,
        name: name || code,
        date,
        close,
        volume,
        code
      };
    })
    .filter(item => /^\d{4,6}$/.test(item.code) && item.close > 0)
    .map(({ code, ...rest }) => rest);
}

function parseTpexOpenApiRows(payload) {
  const rows = Array.isArray(payload) ? payload : [];

  return rows
    .map(item => {
      const code = String(item?.SecuritiesCompanyCode || '').trim();
      const name = String(item?.CompanyName || '').trim();
      const close = toNumber(item?.Close);
      const volume = toNumber(item?.TradingShares);
      const dateText = String(item?.Date || '').trim(); // ROC: 1150407

      const yy = Number(dateText.slice(0, 3));
      const mm = dateText.slice(3, 5);
      const dd = dateText.slice(5, 7);
      const date = Number.isFinite(yy) && yy > 0 ? `${yy + 1911}-${mm}-${dd}` : null;

      return {
        ticker: `${code}.TWO`,
        name: name || code,
        date,
        close,
        volume,
        code
      };
    })
    .filter(item => /^\d{4,6}[A-Z]?$/.test(item.code) && !!item.date && item.close > 0)
    .map(({ code, ...rest }) => rest);
}

async function fetchTwseDailyRows(dateObj) {
  const payload = await fetchJsonWithRetry(TWSE_MI_INDEX_URL, {
    response: 'json',
    date: toTwseDate(dateObj),
    type: 'ALLBUT0999'
  });

  return parseTwseRows(payload, dateObj);
}

async function fetchTpexDailyRows(dateObj) {
  try {
    const payload = await fetchJsonWithRetry(TPEX_QUOTES_URL, {
      l: 'zh-tw',
      d: toTpexRocDate(dateObj),
      se: 'EW'
    });

    return parseTpexRows(payload, dateObj);
  } catch {
    const fallbackPayload = await fetchJsonWithRetry(TPEX_MAINBOARD_OPENAPI_URL, {});
    return parseTpexOpenApiRows(fallbackPayload);
  }
}

async function getLatestTaiwanMarketSnapshot() {
  const today = new Date();

  const [twseResult, tpexResult] = await Promise.allSettled([
    fetchTwseDailyRows(today),
    fetchTpexDailyRows(today)
  ]);

  const twseRows = twseResult.status === 'fulfilled' ? twseResult.value : [];
  const tpexRows = tpexResult.status === 'fulfilled' ? tpexResult.value : [];

  const rows = [...twseRows, ...tpexRows];
  if (rows.length === 0) {
    return {
      waiting: true,
      tradingDate: toIsoDate(today),
      rows: []
    };
  }

  // Some official sources can still return previous trading day early in the day.
  // Use the latest actual row date instead of forcing today's date.
  const tradingDate = rows.reduce((maxDate, row) => {
    const rowDate = String(row?.date || '');
    if (!rowDate) return maxDate;
    return !maxDate || rowDate > maxDate ? rowDate : maxDate;
  }, '');

  return {
    waiting: false,
    tradingDate: tradingDate || toIsoDate(today),
    rows
  };
}

async function getTaiwanTickerUniverse() {
  // For seed script: fallback to recent days if today is not yet published.
  for (let back = 0; back < 7; back += 1) {
    const dateObj = new Date(Date.now() - back * 24 * 60 * 60 * 1000);
    const [twseResult, tpexResult] = await Promise.allSettled([
      fetchTwseDailyRows(dateObj),
      fetchTpexDailyRows(dateObj)
    ]);

    const twseRows = twseResult.status === 'fulfilled' ? twseResult.value : [];
    const tpexRows = tpexResult.status === 'fulfilled' ? tpexResult.value : [];

    const rows = [...twseRows, ...tpexRows];
    if (rows.length > 0) {
      return rows.map(item => ({
        ticker: item.ticker,
        name: item.name
      }));
    }
  }

  return [];
}

module.exports = {
  getLatestTaiwanMarketSnapshot,
  getTaiwanTickerUniverse
};
