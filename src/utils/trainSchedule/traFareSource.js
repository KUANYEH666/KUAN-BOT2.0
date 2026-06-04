const path = require('path');
const { getTdxAccessToken, hasTdxCredentials } = require('./traTdxAuth');
const {
  getMemoryCache,
  setMemoryCache,
  readJsonFile,
  writeJsonFile
} = require('./traScheduleCache');

const TDX_TRA_BASE_URL = 'https://tdx.transportdata.tw/api/basic/v3/Rail/TRA';
const FARE_CACHE_DIR = path.join(process.cwd(), 'data', 'train', 'fares');
const FARE_CACHE_TTL_MS = Number(process.env.TRA_FARE_CACHE_TTL_DAYS || 14) * 24 * 60 * 60 * 1000;

function buildFareUrl(originStationId, destinationStationId) {
  return `${TDX_TRA_BASE_URL}/ODFare/${encodeURIComponent(originStationId)}/to/${encodeURIComponent(destinationStationId)}?$format=JSON`;
}

function fareCacheKey(originStationId, destinationStationId) {
  return `tdx:tra:odfare:${originStationId}:${destinationStationId}`;
}

function fareCachePath(originStationId, destinationStationId) {
  return path.join(FARE_CACHE_DIR, `${originStationId}-${destinationStationId}.json`);
}

function isFreshCache(payload) {
  const cachedAt = new Date(payload?.cachedAt || 0).getTime();
  return Number.isFinite(cachedAt) && Date.now() - cachedAt <= FARE_CACHE_TTL_MS;
}

function getLocalizedName(value) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  return value.Zh_tw || value.zh_tw || value.ZhTw || value.En || '';
}

function firstNumber(...values) {
  for (const value of values) {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function hasDirectPrice(row) {
  return row?.Price != null ||
    row?.Fare != null ||
    row?.AdultFare != null ||
    row?.TicketPrice != null ||
    row?.Fares?.Adult != null ||
    row?.Fares?.AdultFare != null ||
    row?.Fares?.Price != null ||
    row?.DiscountFare?.Adult != null;
}

function collectFareRows(payload) {
  const flattened = [];

  const pushFare = (fare, parent = {}) => {
    if (!fare || typeof fare !== 'object') return;
    flattened.push({ fare, parent });
  };

  const collectFromParent = parent => {
    if (!parent || typeof parent !== 'object') return false;

    if (Array.isArray(parent.Fares)) {
      parent.Fares.forEach(fare => pushFare(fare, parent));
      return true;
    }

    if (hasDirectPrice(parent)) {
      pushFare(parent, {});
      return true;
    }

    return false;
  };

  if (Array.isArray(payload?.ODFares)) {
    payload.ODFares.forEach(collectFromParent);
    return flattened;
  }

  if (Array.isArray(payload?.Fares)) {
    collectFromParent(payload);
    return flattened;
  }

  if (Array.isArray(payload)) {
    payload.forEach(item => {
      if (!collectFromParent(item) && Array.isArray(item?.ODFares)) {
        item.ODFares.forEach(collectFromParent);
      }
    });
    return flattened;
  }

  const nested = [];
  const visit = value => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!value || typeof value !== 'object') return;
    if (hasDirectPrice(value)) {
      nested.push({ fare: value, parent: {} });
    }
    Object.values(value).forEach(visit);
  };
  visit(payload);
  return nested;
}

function normalizeFareRows(payload) {
  const rows = collectFareRows(payload);

  return rows
    .map(({ fare: row, parent }) => {
      const price = firstNumber(
        row?.Price,
        row?.Fare,
        row?.AdultFare,
        row?.TicketPrice,
        row?.Fares?.Adult,
        row?.Fares?.AdultFare,
        row?.Fares?.Price,
        row?.DiscountFare?.Adult
      );
      return {
        trainType: String(parent?.TrainType ?? row?.TrainType ?? row?.TrainTypeCode ?? '').trim(),
        trainTypeName: getLocalizedName(parent?.TrainTypeName || row?.TrainTypeName || row?.FareClassName || row?.TicketTypeName),
        direction: String(parent?.Direction ?? row?.Direction ?? '').trim(),
        ticketType: String(row?.TicketType ?? '').trim(),
        fareClass: String(row?.FareClass ?? '').trim(),
        cabinClass: String(row?.CabinClass ?? '').trim(),
        price,
        raw: {
          ...parent,
          ...row,
          parentFare: parent,
          fareDetail: row
        }
      };
    })
    .filter(row => row.price != null);
}

function summarizeFareRows(rows) {
  const summary = rows.reduce((acc, row) => {
    const category = getFareRowCategory(row) || 'unknown';
    acc[category] = (acc[category] || 0) + 1;
    return acc;
  }, {});
  return Object.entries(summary)
    .map(([category, count]) => `${category}:${count}`)
    .join(', ');
}

async function fetchOdfareRows(originStationId, destinationStationId) {
  if (!hasTdxCredentials()) {
    console.warn('[traFareSource] missing TDX_CLIENT_ID or TDX_CLIENT_SECRET');
    return {
      ok: false,
      reason: 'TDX credentials are not configured.',
      rows: [],
      updatedAt: new Date().toISOString(),
      source: 'TDX ODFare'
    };
  }

  const key = fareCacheKey(originStationId, destinationStationId);
  const cachedMemory = getMemoryCache(key, FARE_CACHE_TTL_MS);
  if (cachedMemory && cachedMemory.rows?.length > 0) {
    console.log(`[traFareSource] ODFare success: ${cachedMemory.rows.length} fare rows (memory cache)`);
    return cachedMemory;
  }
  if (cachedMemory) {
    console.warn('[traFareSource] ignore empty ODFare memory cache');
  }

  const filePath = fareCachePath(originStationId, destinationStationId);
  const cachedFile = readJsonFile(filePath);
  if (cachedFile && isFreshCache(cachedFile)) {
    const result = {
      ok: true,
      rows: normalizeFareRows(cachedFile.payload),
      updatedAt: cachedFile.updatedAt || cachedFile.cachedAt,
      source: 'TDX ODFare',
      fromCache: true
    };
    console.log(`[traFareSource] ODFare success: ${result.rows.length} fare rows (file cache${result.rows.length > 0 ? `, ${summarizeFareRows(result.rows)}` : ''})`);
    if (result.rows.length > 0) {
      setMemoryCache(key, result);
    }
    return result;
  }

  try {
    console.log(`[traFareSource] request ODFare: ${originStationId} -> ${destinationStationId}`);
    const token = await getTdxAccessToken();
    if (!token) {
      console.warn('[traFareSource] ODFare failed: TDX token unavailable.');
      return {
        ok: false,
        reason: 'TDX token unavailable.',
        rows: [],
        updatedAt: new Date().toISOString(),
        source: 'TDX ODFare'
      };
    }

    const response = await fetch(buildFareUrl(originStationId, destinationStationId), {
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error(`TDX ODFare HTTP ${response.status}`);
    }

    const payload = await response.json();
    const result = {
      ok: true,
      rows: normalizeFareRows(payload),
      updatedAt: payload?.UpdateTime || new Date().toISOString(),
      source: 'TDX ODFare',
      fromCache: false
    };
    console.log(`[traFareSource] ODFare success: ${result.rows.length} fare rows${result.rows.length > 0 ? ` (${summarizeFareRows(result.rows)})` : ''}`);

    writeJsonFile(filePath, {
      cachedAt: new Date().toISOString(),
      updatedAt: result.updatedAt,
      payload
    });
    if (result.rows.length > 0) {
      setMemoryCache(key, result);
    }
    return result;
  } catch (error) {
    console.warn(`[traFareSource] ODFare failed: ${error.message}`);
    return {
      ok: false,
      reason: error.message,
      rows: [],
      updatedAt: new Date().toISOString(),
      source: 'TDX ODFare'
    };
  }
}

function getFareCategory(train) {
  const code = String(train?.trainClassCode || train?.trainTypeCode || '').toUpperCase();
  const text = `${train?.trainType || ''} ${code}`;

  const codeMap = {
    '1100': 'tzeChiang',
    '1101': 'tzeChiang',
    '1102': 'tzeChiang',
    '1103': 'tzeChiang',
    '1107': 'tzeChiang',
    '1108': 'tzeChiang',
    '110A': 'tzeChiang',
    '110B': 'tzeChiang',
    '110C': 'tzeChiang',
    '110G': 'tzeChiang',
    '1110': 'chuKuang',
    '1111': 'chuKuang',
    '1114': 'chuKuang',
    '1115': 'chuKuang',
    '1120': 'local',
    '1130': 'local',
    '1131': 'local',
    '1132': 'local',
    '1140': 'local'
  };
  if (codeMap[code]) return codeMap[code];
  if (/區間|區間快|復興|普通/.test(text)) return 'local';
  if (/莒光/.test(text)) return 'chuKuang';
  if (/自強|普悠瑪|太魯閣|3000/.test(text)) return 'tzeChiang';
  return 'unknown';
}

function rowText(row) {
  return `${row.trainType} ${row.trainTypeName} ${row.raw?.TrainTypeName || ''}`.toLowerCase();
}

function getFareRowCategory(row) {
  const trainType = String(row?.trainType || '').trim().toUpperCase();
  const trainTypeMap = {
    '1': 'tzeChiang',
    '2': 'tzeChiang',
    '3': 'tzeChiang',
    '11': 'tzeChiang',
    '4': 'chuKuang',
    '5': 'local',
    '6': 'local',
    '10': 'local'
  };

  if (trainTypeMap[trainType]) return trainTypeMap[trainType];

  const text = rowText(row);
  if (/區間|區間快|普通|復興|commuter|local/.test(text)) return 'local';
  if (/莒光|chu/.test(text)) return 'chuKuang';
  if (/自強|普悠瑪|太魯閣|3000|express|tze|taroko|puyuma/.test(text)) return 'tzeChiang';
  return null;
}

function isAdultOneWay(row) {
  const ticketOk = !row.ticketType || row.ticketType === '1' || /一般|單程|one/i.test(String(row.raw?.TicketTypeName || ''));
  const fareOk = !row.fareClass || row.fareClass === '1' || /成人|adult/i.test(String(row.raw?.FareClassName || ''));
  const cabinOk = !row.cabinClass || row.cabinClass === '1';
  return ticketOk && fareOk && cabinOk;
}

function findTextMatch(rows, category) {
  const matchers = {
    local: /區間|普通|復興|commuter|local/,
    chuKuang: /莒光|chu/,
    tzeChiang: /自強|普悠瑪|太魯閣|3000|express|tze|taroko|puyuma/
  };
  const matcher = matchers[category];
  if (!matcher) return null;
  return rows.find(row => matcher.test(rowText(row))) || null;
}

function findCategoryMatch(rows, category) {
  const matched = rows
    .filter(row => getFareRowCategory(row) === category)
    .sort((a, b) => a.price - b.price);
  return matched[0] || null;
}

function findRankFallback(rows, category) {
  const sorted = [...rows].sort((a, b) => a.price - b.price);
  if (sorted.length === 0) return null;
  if (category === 'local') return sorted[0];
  if (category === 'tzeChiang') return sorted[sorted.length - 1];
  if (category === 'chuKuang') return sorted[Math.min(1, sorted.length - 1)];
  return null;
}

function pickFareForTrain(fareRows, train) {
  const candidates = fareRows.filter(isAdultOneWay);
  const rows = candidates.length > 0 ? candidates : fareRows;
  const category = getFareCategory(train);
  const matched = findCategoryMatch(rows, category) || findTextMatch(rows, category) || findRankFallback(rows, category);

  if (!matched) {
    if (rows.length > 0) {
      console.warn(`[traFareSource] unknown fare class: trainNo=${train?.trainNumber || ''}, trainType=${train?.trainType || ''}, trainTypeCode=${train?.trainClassCode || train?.trainTypeCode || ''}`);
    }
    return {
      price: null,
      fareText: '票價查無',
      fare: {
        amount: null,
        label: '票價查無',
        source: 'TDX_ODFare'
      },
      fareSource: 'TDX ODFare'
    };
  }

  return {
    price: matched.price,
    fareText: `$${matched.price}`,
    fare: {
      amount: matched.price,
      label: `$${matched.price}`,
      source: 'TDX_ODFare'
    },
    fareSource: 'TDX ODFare',
    fareCategory: category,
    fareTrainType: matched.trainTypeName || matched.trainType
  };
}

async function getFareMapForTrains({ originStationId, destinationStationId, trains }) {
  const fareResult = await fetchOdfareRows(originStationId, destinationStationId);
  const byTrainNo = new Map();

  for (const train of trains) {
    byTrainNo.set(String(train.trainNumber), pickFareForTrain(fareResult.rows, train));
  }

  return {
    ...fareResult,
    byTrainNo
  };
}

module.exports = {
  getFareMapForTrains,
  fetchOdfareRows,
  pickFareForTrain
};
