const MAX_PAST_DAYS = 30;

function getTaipeiDateParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);
  return Object.fromEntries(parts.map(part => [part.type, part.value]));
}

function getTaipeiToday() {
  const parts = getTaipeiDateParts();
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function addDaysToIsoDate(isoDate, days) {
  const date = new Date(`${isoDate}T00:00:00+08:00`);
  date.setUTCDate(date.getUTCDate() + days);
  const parts = getTaipeiDateParts(date);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function normalizeIsoDate(value) {
  const text = String(value || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  if (/^\d{8}$/.test(text)) {
    return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`;
  }
  return null;
}

function parseUserExplicitDate(userText, today = getTaipeiToday()) {
  const text = String(userText || '').trim();
  if (!text) return null;

  if (/後天/.test(text)) return addDaysToIsoDate(today, 2);
  if (/明天|明日/.test(text)) return addDaysToIsoDate(today, 1);
  if (/今天|今日/.test(text)) return today;

  const fullIso = text.match(/\b(20\d{2})[-/](\d{1,2})[-/](\d{1,2})\b/);
  if (fullIso) {
    return `${fullIso[1]}-${fullIso[2].padStart(2, '0')}-${fullIso[3].padStart(2, '0')}`;
  }

  const fullCompact = text.match(/\b(20\d{2})(\d{2})(\d{2})\b/);
  if (fullCompact) {
    return `${fullCompact[1]}-${fullCompact[2]}-${fullCompact[3]}`;
  }

  const monthDay = text.match(/(?:^|[^\d])(\d{1,2})\s*[\/月]\s*(\d{1,2})(?:\s*日)?(?:$|[^\d])/);
  if (monthDay) {
    const year = today.slice(0, 4);
    return `${year}-${monthDay[1].padStart(2, '0')}-${monthDay[2].padStart(2, '0')}`;
  }

  return null;
}

function daysBetween(startIso, endIso) {
  const start = new Date(`${startIso}T00:00:00+08:00`).getTime();
  const end = new Date(`${endIso}T00:00:00+08:00`).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return Math.round((end - start) / (24 * 60 * 60 * 1000));
}

function hasExplicitFullDate(userText) {
  const text = String(userText || '');
  return /\b20\d{2}[-/]\d{1,2}[-/]\d{1,2}\b/.test(text) || /\b20\d{6}\b/.test(text);
}

function resolveTrainQueryDate({ userText, llmDate } = {}) {
  const today = getTaipeiToday();
  const explicitDate = parseUserExplicitDate(userText, today);
  const normalizedLlmDate = normalizeIsoDate(llmDate);

  let queryDate = explicitDate || normalizedLlmDate || today;
  let reason = explicitDate ? 'user_explicit_or_relative_date' : (normalizedLlmDate ? 'llm_date' : 'default_today');

  const pastDays = daysBetween(queryDate, today);
  const llmLooksSuspicious = normalizedLlmDate && pastDays != null && pastDays > MAX_PAST_DAYS;
  if (llmLooksSuspicious && !hasExplicitFullDate(userText)) {
    queryDate = today;
    reason = 'suspicious_llm_past_date_default_today';
  }

  return {
    queryDate,
    today,
    originalDate: llmDate || null,
    userText: userText || '',
    reason
  };
}

module.exports = {
  resolveTrainQueryDate,
  getTaipeiToday,
  parseUserExplicitDate,
  normalizeIsoDate
};
