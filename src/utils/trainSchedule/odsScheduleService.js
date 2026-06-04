const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');

const DATASET_HOST = 'https://ods.railway.gov.tw';
const ODS_JSON_LIST_URL = 'http://ods.railway.gov.tw/tra-ods-web/ods/download/dataResource/railway_schedule/JSON/list';
const ODS_XML_LIST_URL = 'http://ods.railway.gov.tw/tra-ods-web/ods/download/dataResource/railway_schedule/XML/list';
const SCHEDULE_CACHE_DIR = path.join(process.cwd(), 'data', 'train', 'schedules');
const LOCAL_STATION_MAP_PATH = path.join(__dirname, '..', '..', 'JSON', 'tra_station_map.json');

const listCache = new Map();

const OLD_TO_NEW_STATION_CODES = {
  '1001': '0900',
  '1002': '0920',
  '1003': '0930',
  '1004': '0950',
  '1005': '0960',
  '1006': '0980',
  '1007': '0990',
  '1008': '1000',
  '1011': '1020',
  '1012': '1040',
  '1013': '1070',
  '1014': '1080',
  '1015': '1100',
  '1025': '1210',
  '1319': '3300',
  '1238': '4400'
};

const STATION_ALIASES = {
  '北車': '臺北',
  '台北': '臺北',
  '台北車站': '臺北',
  '臺北車站': '臺北',
  '台中': '臺中',
  '台中車站': '臺中',
  '臺中車站': '臺中',
  '台南': '臺南',
  '台南車站': '臺南',
  '臺南車站': '臺南',
  '台東': '臺東',
  '台東車站': '臺東',
  '臺東車站': '臺東',
  '高雄車站': '高雄',
  '花蓮車站': '花蓮',
  '新竹車站': '新竹',
  '板橋車站': '板橋',
  '桃園車站': '桃園',
  '中壢車站': '中壢'
};

const TRAIN_CLASS_NAMES = {
  '1100': '自強',
  '1101': '自強',
  '1102': '太魯閣',
  '1103': '自強',
  '1107': '普悠瑪',
  '1108': '自強',
  '110A': '自強',
  '110B': '自強',
  '110C': '自強',
  '110G': '自強',
  '1110': '莒光號',
  '1111': '莒光號',
  '1114': '莒光號',
  '1115': '莒光號',
  '1120': '復興',
  '1130': '區間車',
  '1131': '區間車',
  '1132': '區間快',
  '1140': '平快'
};

function ensureDirectory(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function toTaipeiDateParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);

  const byType = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return {
    year: byType.year,
    month: byType.month,
    day: byType.day
  };
}

function todayIsoDate() {
  const { year, month, day } = toTaipeiDateParts();
  return `${year}-${month}-${day}`;
}

function normalizeDateInput(date) {
  if (!date) return todayIsoDate();

  const value = String(date).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  if (/^\d{8}$/.test(value)) {
    return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
  }

  return value;
}

function toDateKey(date) {
  const iso = normalizeDateInput(date);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  return iso.replace(/-/g, '');
}

function isValidIsoDate(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ''))) return false;
  const parsed = new Date(`${date}T00:00:00+08:00`);
  return !Number.isNaN(parsed.getTime());
}

function fetchText(url, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https:') ? https : http;
    const request = client.get(url, {
      headers: {
        accept: 'text/html,application/json,application/xml,text/xml,text/plain,*/*',
        'user-agent': 'KUAN-BOT2.0 train schedule client'
      }
    }, response => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        response.resume();
        const redirectUrl = response.headers.location.startsWith('http')
          ? response.headers.location
          : `${DATASET_HOST}${response.headers.location}`;
        fetchText(redirectUrl, timeoutMs).then(resolve).catch(reject);
        return;
      }

      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`HTTP ${response.statusCode}`));
        return;
      }

      const chunks = [];
      response.on('data', chunk => chunks.push(Buffer.from(chunk)));
      response.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    });

    request.setTimeout(timeoutMs, () => {
      request.destroy(new Error(`Request timeout after ${timeoutMs}ms`));
    });
    request.on('error', reject);
  });
}

async function fetchListHtml(kind) {
  const cacheKey = kind.toLowerCase();
  const cached = listCache.get(cacheKey);
  if (cached && Date.now() - cached.updatedAt < 60 * 60 * 1000) {
    return cached.html;
  }

  const listUrl = cacheKey === 'xml' ? ODS_XML_LIST_URL : ODS_JSON_LIST_URL;
  const html = await fetchText(listUrl);
  listCache.set(cacheKey, {
    html,
    updatedAt: Date.now()
  });
  return html;
}

async function resolveOdsDownloadUrl(dateKey, kind) {
  const ext = kind.toLowerCase() === 'xml' ? 'xml' : 'json';
  const html = await fetchListHtml(ext);
  const pattern = new RegExp(`href="([^"]+)"[^>]*>${dateKey}\\.${ext}<`, 'i');
  const match = html.match(pattern);
  if (!match) return null;

  const href = match[1].replace(/&amp;/g, '&');
  return href.startsWith('http') ? href : `${DATASET_HOST}${href}`;
}

function scheduleCachePath(dateKey, ext = 'json') {
  return path.join(SCHEDULE_CACHE_DIR, `${dateKey}.${ext}`);
}

async function loadOdsJsonPayload(dateKey) {
  ensureDirectory(SCHEDULE_CACHE_DIR);
  const cachePath = scheduleCachePath(dateKey, 'json');

  if (fs.existsSync(cachePath)) {
    return {
      payload: JSON.parse(fs.readFileSync(cachePath, 'utf8')),
      source: 'ODS JSON',
      cachePath,
      fromCache: true
    };
  }

  const downloadUrl = await resolveOdsDownloadUrl(dateKey, 'json');
  if (!downloadUrl) {
    throw new Error(`ODS JSON schedule not found for ${dateKey}`);
  }

  const raw = await fetchText(downloadUrl);
  const payload = JSON.parse(raw);
  fs.writeFileSync(cachePath, JSON.stringify(payload), 'utf8');

  return {
    payload,
    source: 'ODS JSON',
    cachePath,
    fromCache: false
  };
}

async function loadOdsXmlPayload(dateKey) {
  ensureDirectory(SCHEDULE_CACHE_DIR);
  const cachePath = scheduleCachePath(dateKey, 'xml');

  if (fs.existsSync(cachePath)) {
    return {
      raw: fs.readFileSync(cachePath, 'utf8'),
      source: 'ODS XML',
      cachePath,
      fromCache: true
    };
  }

  const downloadUrl = await resolveOdsDownloadUrl(dateKey, 'xml');
  if (!downloadUrl) {
    throw new Error(`ODS XML schedule not found for ${dateKey}`);
  }

  const raw = await fetchText(downloadUrl);
  fs.writeFileSync(cachePath, raw, 'utf8');

  return {
    raw,
    source: 'ODS XML',
    cachePath,
    fromCache: false
  };
}

function loadStationMap() {
  const raw = fs.readFileSync(LOCAL_STATION_MAP_PATH, 'utf8');
  const nameToCode = JSON.parse(raw);
  const codeToName = {};

  for (const [name, code] of Object.entries(nameToCode)) {
    codeToName[String(code)] = name;
  }

  return { nameToCode, codeToName };
}

function canonicalStationInput(input) {
  return String(input || '')
    .replace(/[（()）\s]/g, '')
    .replace(/臺/g, '台')
    .replace(/(火車站|車站|站)$/g, '')
    .trim();
}

function normalizeStation(input) {
  const { nameToCode, codeToName } = loadStationMap();
  const raw = String(input || '').trim();
  if (!raw) return null;

  if (/^\d{4}$/.test(raw)) {
    const code = OLD_TO_NEW_STATION_CODES[raw] || raw;
    const name = codeToName[code];
    if (!name) return null;
    return { code, name };
  }

  const directAlias = STATION_ALIASES[raw] || raw;
  if (nameToCode[directAlias]) {
    return {
      code: String(nameToCode[directAlias]),
      name: directAlias
    };
  }

  const inputKey = canonicalStationInput(directAlias);
  for (const [name, code] of Object.entries(nameToCode)) {
    if (canonicalStationInput(name) === inputKey) {
      return {
        code: String(code),
        name
      };
    }
  }

  return null;
}

function trimTime(time) {
  const text = String(time || '').trim();
  const match = text.match(/^(\d{1,2}):(\d{2})/);
  if (!match) return '';
  return `${match[1].padStart(2, '0')}:${match[2]}`;
}

function timeToMinutes(time) {
  const normalized = trimTime(time);
  const match = normalized.match(/^(\d{2}):(\d{2})$/);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

function minutesToDuration(minutes) {
  if (!Number.isFinite(minutes) || minutes < 0) return '計算中';
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours === 0) return `${mins}m`;
  return `${hours}h${mins > 0 ? `${mins}m` : ''}`;
}

function normalizeTimeInfos(timeInfos) {
  const rows = Array.isArray(timeInfos) ? timeInfos : [];
  let dayOffset = 0;
  let previousComparable = null;

  return rows
    .map(row => {
      const depTime = trimTime(row?.DEPTime);
      const arrTime = trimTime(row?.ARRTime);
      const comparableTime = timeToMinutes(depTime || arrTime);

      if (previousComparable != null && comparableTime != null && comparableTime < previousComparable - 120) {
        dayOffset += 1;
      }
      if (comparableTime != null) {
        previousComparable = comparableTime;
      }

      return {
        station: String(row?.Station || '').trim(),
        order: Number(row?.Order || 0),
        departureTime: depTime,
        arrivalTime: arrTime,
        dayOffset
      };
    })
    .filter(row => row.station && Number.isFinite(row.order));
}

function getTrainType(carClass) {
  const code = String(carClass || '').trim();
  return TRAIN_CLASS_NAMES[code] || `車種 ${code || '未知'}`;
}

function buildTrainResult(train, originStop, destinationStop, stationNames) {
  const departureBase = timeToMinutes(originStop.departureTime || originStop.arrivalTime);
  const arrivalBase = timeToMinutes(destinationStop.arrivalTime || destinationStop.departureTime);
  const departureAbs = departureBase + originStop.dayOffset * 1440;
  let arrivalAbs = arrivalBase + destinationStop.dayOffset * 1440;

  if (arrivalAbs < departureAbs) {
    arrivalAbs += 1440;
  }

  return {
    trainNumber: String(train.Train || ''),
    trainType: getTrainType(train.CarClass),
    trainClassCode: String(train.CarClass || ''),
    origin: stationNames.origin,
    destination: stationNames.destination,
    originStationId: originStop.station,
    destinationStationId: destinationStop.station,
    departureTime: originStop.departureTime || originStop.arrivalTime,
    arrivalTime: destinationStop.arrivalTime || destinationStop.departureTime,
    departureDayOffset: originStop.dayOffset,
    arrivalDayOffset: Math.floor(arrivalAbs / 1440),
    duration: minutesToDuration(arrivalAbs - departureAbs),
    durationMinutes: arrivalAbs - departureAbs,
    price: null,
    delay: 0,
    stops: Math.max(0, destinationStop.order - originStop.order),
    note: train.Note || '',
    everyday: train.Everyday || '',
    line: train.Line || '',
    lineDir: train.LineDir || ''
  };
}

function parseJsonSchedule(payload) {
  return {
    updateTime: payload?.UpdateTime || '',
    trains: Array.isArray(payload?.TrainInfos) ? payload.TrainInfos : []
  };
}

function decodeXmlEntities(text) {
  return String(text || '')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function parseXmlAttributes(text) {
  const attributes = {};
  const attrRegex = /([A-Za-z0-9_:-]+)="([^"]*)"/g;
  let match;
  while ((match = attrRegex.exec(text)) !== null) {
    attributes[match[1]] = decodeXmlEntities(match[2]);
  }
  return attributes;
}

function parseXmlSchedule(raw) {
  const updateTime = raw.match(/<updateTime[^>]*value="([^"]*)"/i)?.[1] || '';
  const trains = [];
  const trainRegex = /<TrainInfo\b([^>]*)>([\s\S]*?)<\/TrainInfo>/g;
  let trainMatch;

  while ((trainMatch = trainRegex.exec(raw)) !== null) {
    const train = parseXmlAttributes(trainMatch[1]);
    train.TimeInfos = [];

    const timeRegex = /<TimeInfo\b([^/>]*)\/>/g;
    let timeMatch;
    while ((timeMatch = timeRegex.exec(trainMatch[2])) !== null) {
      train.TimeInfos.push(parseXmlAttributes(timeMatch[1]));
    }

    trains.push(train);
  }

  return { updateTime, trains };
}

function filterTrains({ trains, origin, destination }) {
  const stationNames = {
    origin: origin.name,
    destination: destination.name
  };
  const results = [];

  for (const train of trains) {
    const stops = normalizeTimeInfos(train.TimeInfos);
    const originStop = stops.find(stop => stop.station === origin.code);
    const destinationStop = stops.find(stop => stop.station === destination.code);

    if (!originStop || !destinationStop) continue;
    if (originStop.order >= destinationStop.order) continue;

    results.push(buildTrainResult(train, originStop, destinationStop, stationNames));
  }

  return results.sort((a, b) => {
    const aDep = timeToMinutes(a.departureTime) + a.departureDayOffset * 1440;
    const bDep = timeToMinutes(b.departureTime) + b.departureDayOffset * 1440;
    return aDep - bDep;
  });
}

async function loadOdsSchedule(dateKey) {
  try {
    const jsonData = await loadOdsJsonPayload(dateKey);
    return {
      ...parseJsonSchedule(jsonData.payload),
      dataSource: jsonData.source,
      cachePath: jsonData.cachePath,
      fromCache: jsonData.fromCache
    };
  } catch (jsonError) {
    console.warn('[trainSchedule] ODS JSON unavailable, trying XML fallback:', jsonError.message);
  }

  const xmlData = await loadOdsXmlPayload(dateKey);
  return {
    ...parseXmlSchedule(xmlData.raw),
    dataSource: xmlData.source,
    cachePath: xmlData.cachePath,
    fromCache: xmlData.fromCache
  };
}

async function searchOdsTrainSchedules(params) {
  const queryDate = normalizeDateInput(params?.date);
  const dateKey = toDateKey(queryDate);
  if (!dateKey || !isValidIsoDate(queryDate)) {
    return {
      error: 'INVALID_DATE',
      message: '日期格式錯誤，應為 YYYY-MM-DD。'
    };
  }

  const origin = normalizeStation(params?.origin);
  const destination = normalizeStation(params?.destination);
  if (!origin || !destination) {
    return {
      error: 'INVALID_STATION',
      message: '無法識別的車站名稱。'
    };
  }

  const schedule = await loadOdsSchedule(dateKey);
  const data = filterTrains({
    trains: schedule.trains,
    origin,
    destination
  });

  return {
    success: true,
    origin: origin.name,
    destination: destination.name,
    date: queryDate,
    dateKey,
    data,
    count: data.length,
    dataSource: schedule.dataSource,
    updatedAt: schedule.updateTime || new Date().toISOString(),
    cachePath: schedule.cachePath,
    fromCache: schedule.fromCache
  };
}

module.exports = {
  searchOdsTrainSchedules,
  normalizeStation,
  normalizeDateInput,
  toDateKey,
  isValidIsoDate,
  trimTime,
  timeToMinutes,
  minutesToDuration
};
