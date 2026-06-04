const { getMemoryCache, setMemoryCache } = require('./traScheduleCache');
const { getTdxAccessToken, hasTdxCredentials } = require('./traTdxAuth');

const TDX_TRA_BASE_URL = 'https://tdx.transportdata.tw/api/basic/v3/Rail/TRA';
const REALTIME_CACHE_TTL_MS = Number(process.env.TRA_REALTIME_CACHE_TTL_MS || 45_000);

function buildRealtimeEndpoint() {
  const params = new URLSearchParams({ '$format': 'JSON' });
  return `${TDX_TRA_BASE_URL}/TrainLiveBoard?${params.toString()}`;
}

function normalizeLiveBoardItem(item) {
  const trainNo = String(item?.TrainNo || item?.TrainNumber || '').trim();
  if (!trainNo) return null;

  const delayTime = Number(item?.DelayTime ?? item?.Delay ?? item?.DelayMinutes ?? 0);
  const stationName = item?.StationName?.Zh_tw || item?.StationName?.Zh_tw || item?.StationName || item?.TrainStationName || '';
  const status = item?.TrainLiveBoardStatus ?? item?.Status ?? item?.TrainStationStatus ?? '';
  const updateTime = item?.UpdateTime || item?.SrcUpdateTime || '';

  return {
    trainNo,
    delayTime: Number.isFinite(delayTime) ? delayTime : 0,
    delayText: Number.isFinite(delayTime) && delayTime > 0 ? `🟡 誤點 ${delayTime} 分` : '🟢 準點',
    status,
    stationId: item?.StationID || item?.StationId || '',
    stationName: typeof stationName === 'string' ? stationName : '',
    trainLocation: item?.TrainLocation ?? item?.Location ?? '',
    direction: item?.Direction ?? '',
    updateTime,
    raw: item
  };
}

async function fetchTrainLiveBoard(trainDate) {
  if (!hasTdxCredentials()) {
    return {
      ok: false,
      source: 'TDX TrainLiveBoard',
      reason: 'TDX credentials are not configured.',
      updatedAt: new Date().toISOString(),
      byTrainNo: new Map()
    };
  }

  const cacheKey = `tdx:tra:train-live-board:${trainDate || 'today'}`;
  const cached = getMemoryCache(cacheKey, REALTIME_CACHE_TTL_MS);
  if (cached) return cached;

  const token = await getTdxAccessToken();
  if (!token) {
    return {
      ok: false,
      source: 'TDX TrainLiveBoard',
      reason: 'TDX token unavailable.',
      updatedAt: new Date().toISOString(),
      byTrainNo: new Map()
    };
  }

  const response = await fetch(buildRealtimeEndpoint(), {
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/json'
    }
  });

  if (!response.ok) {
    throw new Error(`TDX TrainLiveBoard HTTP ${response.status}`);
  }

  const payload = await response.json();
  const rows = Array.isArray(payload)
    ? payload
    : (Array.isArray(payload?.TrainLiveBoards) ? payload.TrainLiveBoards : []);
  const byTrainNo = new Map();

  for (const item of rows) {
    const normalized = normalizeLiveBoardItem(item);
    if (!normalized) continue;
    byTrainNo.set(normalized.trainNo, normalized);
  }

  const result = {
    ok: true,
    source: 'TDX 即時資料',
    updatedAt: payload?.UpdateTime || rows.find(item => item?.UpdateTime)?.UpdateTime || new Date().toISOString(),
    byTrainNo
  };
  setMemoryCache(cacheKey, result);
  return result;
}

async function getRealtimeByTrainNumbers(trainNumbers, trainDate) {
  try {
    const liveBoard = await fetchTrainLiveBoard(trainDate);
    const byTrainNo = new Map();

    for (const trainNo of trainNumbers) {
      const key = String(trainNo || '').trim();
      if (liveBoard.byTrainNo.has(key)) {
        byTrainNo.set(key, liveBoard.byTrainNo.get(key));
      }
    }

    return {
      ...liveBoard,
      byTrainNo
    };
  } catch (error) {
    return {
      ok: false,
      source: 'TDX TrainLiveBoard',
      reason: error.message,
      updatedAt: new Date().toISOString(),
      byTrainNo: new Map()
    };
  }
}

module.exports = {
  getRealtimeByTrainNumbers,
  fetchTrainLiveBoard
};
