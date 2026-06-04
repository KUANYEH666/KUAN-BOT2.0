const axios = require('axios');
const cheerio = require('cheerio');

function normalizeTickerCode(input) {
  const raw = String(input || '').trim().toUpperCase();
  const match = raw.match(/\b(\d{4,6})\b/);
  if (match) return match[1];

  const onlyDigits = raw.replace(/\D/g, '');
  if (onlyDigits.length >= 4 && onlyDigits.length <= 6) {
    return onlyDigits;
  }

  return '';
}

function normalizeSymbolFromInput(input, code) {
  const raw = String(input || '').trim().toUpperCase();
  if (raw.endsWith('.TW') || raw.endsWith('.TWO')) {
    return raw;
  }
  if (!code) return raw;
  return `${code}.TW`;
}

function extractNewsTitle(rawTitle) {
  const title = String(rawTitle || '').trim();
  if (!title) return '';

  const segments = title.split(' - ');
  if (segments.length >= 2) {
    return segments.slice(0, -1).join(' - ').trim();
  }
  return title;
}

function sanitizeSnippet(rawSnippet) {
  const snippetHtml = String(rawSnippet || '').trim();
  if (!snippetHtml) return '';

  const $ = cheerio.load(snippetHtml);
  const text = $.text().replace(/\s+/g, ' ').trim();
  return text.slice(0, 180);
}

async function fetchYahooStockName(symbol) {
  const response = await axios.get('https://query1.finance.yahoo.com/v1/finance/search', {
    timeout: 10000,
    params: {
      q: symbol,
      quotesCount: 8,
      newsCount: 0,
      lang: 'zh-Hant-TW',
      region: 'TW'
    }
  });

  const quotes = Array.isArray(response?.data?.quotes) ? response.data.quotes : [];
  const exact = quotes.find(item => String(item?.symbol || '').toUpperCase() === symbol.toUpperCase());
  const candidate = exact || quotes[0] || null;

  if (!candidate) return '';
  return String(candidate?.shortname || candidate?.longname || '').trim();
}

async function resolveStockInfo(input) {
  const code = normalizeTickerCode(input);
  const rawSymbol = normalizeSymbolFromInput(input, code);

  const candidateSymbols = [];
  if (rawSymbol) candidateSymbols.push(rawSymbol);
  if (code) {
    if (!candidateSymbols.includes(`${code}.TW`)) candidateSymbols.push(`${code}.TW`);
    if (!candidateSymbols.includes(`${code}.TWO`)) candidateSymbols.push(`${code}.TWO`);
  }

  let name = '';
  let symbol = candidateSymbols[0] || rawSymbol || '';

  for (const item of candidateSymbols) {
    try {
      const fetchedName = await fetchYahooStockName(item);
      if (fetchedName) {
        name = fetchedName;
        symbol = item;
        break;
      }
    } catch {
      // 單一來源失敗時繼續嘗試其他候選代碼。
    }
  }

  const displayCode = code || symbol.replace(/\.(TW|TWO)$/i, '');
  return {
    code: displayCode,
    symbol,
    name: name || '未知名稱'
  };
}

async function fetchGoogleNewsByQuery(query, limit = 5) {
  const rssUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=zh-TW&gl=TW&ceid=TW:zh-Hant`;
  const response = await axios.get(rssUrl, {
    timeout: 12000,
    headers: {
      'user-agent': 'Mozilla/5.0'
    }
  });

  const xml = String(response?.data || '');
  const $ = cheerio.load(xml, { xmlMode: true });

  const items = [];
  $('item').each((_, element) => {
    if (items.length >= limit) return;

    const title = extractNewsTitle($(element).find('title').first().text());
    const link = $(element).find('link').first().text().trim();
    const pubDate = $(element).find('pubDate').first().text().trim();
    const source = $(element).find('source').first().text().trim();
    const snippet = sanitizeSnippet($(element).find('description').first().text());

    if (!title || !link) return;

    items.push({
      title,
      link,
      pubDate,
      source,
      snippet
    });
  });

  return items;
}

async function fetchLatestStockNews(stockInfo, limit = 5) {
  const code = String(stockInfo?.code || '').trim();
  const name = String(stockInfo?.name || '').trim();
  const symbol = String(stockInfo?.symbol || '').trim();

  const queries = [
    `${code} ${name} 台股`,
    `${code} ${name} 股票`,
    `${code} ${name}`,
    `${code} 台股`,
    symbol
  ].filter(Boolean);

  const merged = [];
  const seen = new Set();

  for (const query of queries) {
    if (merged.length >= limit) break;

    try {
      const items = await fetchGoogleNewsByQuery(query, limit);
      for (const item of items) {
        const dedupeKey = item.link || item.title;
        if (!dedupeKey || seen.has(dedupeKey)) continue;

        seen.add(dedupeKey);
        merged.push(item);

        if (merged.length >= limit) break;
      }
    } catch {
      // 單一關鍵字查詢失敗時不中斷整體流程。
    }
  }

  return merged.slice(0, limit);
}

module.exports = {
  resolveStockInfo,
  fetchLatestStockNews
};
