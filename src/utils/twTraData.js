/**
 * twTraData.js - 台鐵時刻表與誤點系統
 * Layer 5: 獨立子系統
 * 負責整合靜態時刻表 (L1) 與動態誤點資訊 (L2)
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const NodeCache = require('node-cache');
const { searchOdsTrainSchedules, normalizeDateInput } = require('./trainSchedule/odsScheduleService');
const { queryTraTrains } = require('./trainSchedule/traTrainQuery');

// ============ Layer 6: 快取層 ============
const staticCache = new NodeCache({ stdTTL: 86400 }); // 24h - 靜態時刻表
const dynamicCache = new NodeCache({ stdTTL: 900 }); // 15m - TDX 誤點資訊
const rateLimitCache = new NodeCache({ stdTTL: 86400 }); // 24h - Rate Limit
const datasetListCache = new NodeCache({ stdTTL: 3600 }); // 1h - Dataset list

// ============ 配置 ============
const CONFIG = {
  MAX_QUERIES_PER_DAY: 1000,  // 全頻道日限額
  MAX_QUERIES_PER_MINUTE: 5,   // 分鐘限制（防止濫用）
  STATIC_DATA_PATH: path.join(__dirname, '../JSON/tra_schedule.json'),
  STATION_MAP_PATH: path.join(__dirname, '../JSON/tra_station_map.json'),
  DATASET_LIST_URL: 'https://ods.railway.gov.tw/tra-ods-web/ods/download/dataResource/railway_schedule/JSON/list',
  DATASET_HOST: 'https://ods.railway.gov.tw',
  TDX_API_KEY: process.env.TDX_API_KEY || '',
  TDX_ENDPOINT: 'https://ptx.transportdata.tw/MOTC/v2'
};

// ============ 車站別名字典 ============
const STATION_ALIASES = {
  "北車": "臺北",
  "台北": "臺北",
  "台北車站": "臺北",
  "臺北車站": "臺北",
  "板橋": "板橋",
  "板橋車站": "板橋",
  "台中": "臺中",
  "臺中": "臺中",
  "台中車站": "臺中",
  "臺中車站": "臺中",
  "高雄": "高雄",
  "高雄車站": "高雄",
  "花蓮": "花蓮",
  "花蓮車站": "花蓮",
  "新竹": "新竹",
  "新竹車站": "新竹",
  "中壢": "中壢",
  "中壢車站": "中壢",
  "桃園": "桃園",
  "桃園車站": "桃園",
  "竹北": "竹北",
  "竹北車站": "竹北"
};

// ============ 工具函式 ============

/**
 * 正規化車站名稱
 */
function normalizeStationName(input) {
  if (!input) return null;
  
  // 移除尾部多餘字眼
  const cleaned = input
    .replace(/[（()）\s]/g, '')
    .replace(/(火車站|車站|站)$/g, '');
  
  return STATION_ALIASES[cleaned] || cleaned;
}

/**
 * 驗證日期格式 (YYYY-MM-DD)
 */
function validateDate(dateStr) {
  const normalized = normalizeDateInput(dateStr);
  const regex = /^\d{4}-\d{2}-\d{2}$/;
  if (!regex.test(normalized)) return false;

  const date = new Date(`${normalized}T00:00:00+08:00`);
  return date instanceof Date && !isNaN(date);
}

/**
 * 驗證時間格式 (HH:mm)
 */
function validateTime(timeStr) {
  const regex = /^\d{2}:\d{2}$/;
  if (!regex.test(timeStr)) return false;
  
  const [hours, minutes] = timeStr.split(':').map(Number);
  return hours >= 0 && hours < 24 && minutes >= 0 && minutes < 60;
}

/**
 * 解析模糊時間段為時間範圍
 */
function parseTimeRange(timeRange) {
  const ranges = {
    "morning": { start: "06:00", end: "12:00" },
    "afternoon": { start: "12:00", end: "17:00" },
    "evening": { start: "17:00", end: "20:00" },
    "night": { start: "20:00", end: "23:59" },
    "all": { start: "00:00", end: "23:59" }
  };
  
  return ranges[timeRange?.toLowerCase()] || ranges["all"];
}

/**
 * 載入站碼對照表 (需由使用者維護)
 */
function loadStationCodeMap() {
  try {
    if (!fs.existsSync(CONFIG.STATION_MAP_PATH)) {
      return null;
    }

    const raw = fs.readFileSync(CONFIG.STATION_MAP_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    const entries = Object.entries(parsed || {}).filter(([, code]) => String(code || '').trim());
    if (entries.length === 0) {
      return null;
    }

    return Object.fromEntries(entries.map(([name, code]) => [String(name).trim(), String(code).trim()]));
  } catch (err) {
    console.error('[twTraData] 站碼對照表讀取失敗:', err.message);
    return null;
  }
}

/**
 * 透過 HTTPS 取得文字內容
 */
function fetchText(url) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, response => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        response.resume();
        const redirectUrl = response.headers.location.startsWith('http')
          ? response.headers.location
          : `${CONFIG.DATASET_HOST}${response.headers.location}`;
        fetchText(redirectUrl).then(resolve).catch(reject);
        return;
      }

      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`HTTP ${response.statusCode}`));
        return;
      }

      let data = '';
      response.setEncoding('utf8');
      response.on('data', chunk => {
        data += chunk;
      });
      response.on('end', () => resolve(data));
    });

    request.on('error', reject);
  });
}

/**
 * 取得 dataset 列表 (HTML)
 */
async function fetchDatasetList() {
  const cached = datasetListCache.get('dataset_list_html');
  if (cached) {
    return cached;
  }

  const html = await fetchText(CONFIG.DATASET_LIST_URL);
  datasetListCache.set('dataset_list_html', html);
  return html;
}

/**
 * 取得指定日期的 dataset 下載連結
 */
async function resolveDatasetUrl(date) {
  const dateKey = String(date || '').replace(/-/g, '');
  if (!/^[0-9]{8}$/.test(dateKey)) {
    return null;
  }

  const html = await fetchDatasetList();
  const matches = [...html.matchAll(/href="([^"]+)"[^>]*>(\d{8}\.json)</g)];
  if (matches.length === 0) {
    return null;
  }

  let target = matches.find(match => match[2] === `${dateKey}.json`);
  if (!target) {
    target = matches[0];
  }

  const href = target[1];
  return href.startsWith('http') ? href : `${CONFIG.DATASET_HOST}${href}`;
}

/**
 * 從 dataset 6138 取得時刻表並轉換為內部格式
 */
async function fetchDatasetSchedule(origin, destination, date) {
  const stationMap = loadStationCodeMap();
  if (!stationMap) {
    console.warn('[twTraData] 未設定站碼對照表，無法使用 dataset 6138');
    return null;
  }

  const originCode = stationMap[origin];
  const destinationCode = stationMap[destination];
  if (!originCode || !destinationCode) {
    console.warn('[twTraData] 站碼對照缺少指定車站:', { origin, destination });
    return null;
  }

  const downloadUrl = await resolveDatasetUrl(date);
  if (!downloadUrl) {
    console.warn('[twTraData] 無法取得 dataset 下載連結');
    return null;
  }

  try {
    const raw = await fetchText(downloadUrl);
    const parsed = JSON.parse(raw);
    const trains = Array.isArray(parsed?.TrainInfos) ? parsed.TrainInfos : [];
    if (trains.length === 0) {
      return [];
    }

    const results = [];
    trains.forEach(train => {
      const timeInfos = Array.isArray(train.TimeInfos) ? train.TimeInfos : [];
      const originIndex = timeInfos.findIndex(item => String(item?.Station) === String(originCode));
      const destIndex = timeInfos.findIndex(item => String(item?.Station) === String(destinationCode));
      if (originIndex === -1 || destIndex === -1 || originIndex >= destIndex) {
        return;
      }

      const originTime = timeInfos[originIndex];
      const destTime = timeInfos[destIndex];
      const depTime = String(originTime?.DEPTime || '').slice(0, 5);
      const arrTime = String(destTime?.ARRTime || '').slice(0, 5);
      if (!depTime || !arrTime) {
        return;
      }

      results.push({
        trainNumber: String(train.Train || ''),
        trainType: String(train.CarClass || ''),
        origin,
        destination,
        date,
        departureTime: depTime,
        arrivalTime: arrTime,
        duration: calculateDuration(depTime, arrTime),
        price: 0,
        stops: Math.max(0, destIndex - originIndex)
      });
    });

    return results;
  } catch (err) {
    console.error('[twTraData] dataset 解析失敗:', err.message);
    return null;
  }
}

/**
 * Rate Limiting - 檢查是否超過限額
 */
function checkRateLimit(userId = "global") {
  const key = `rate_limit_${userId}`;
  const count = rateLimitCache.get(key) || 0;
  
  if (count >= CONFIG.MAX_QUERIES_PER_DAY) {
    return { allowed: false, remaining: 0 };
  }
  
  rateLimitCache.set(key, count + 1);
  return { allowed: true, remaining: CONFIG.MAX_QUERIES_PER_DAY - count - 1 };
}

/**
 * 從靜態快取取得時刻表數據（L1）
 */
function fetchStaticSchedule(origin, destination, date) {
  const cacheKey = `schedule_${origin}_${destination}_${date}`;
  let cached = staticCache.get(cacheKey);
  
  if (cached) {
    console.log(`[twTraData] L1 快取命中: ${cacheKey}`);
    return cached;
  }
  
  // 載入靜態 JSON
  try {
    const staticData = JSON.parse(
      fs.readFileSync(CONFIG.STATIC_DATA_PATH, 'utf8')
    );
    
    // 過濾邏輯
    const filtered = staticData.filter(train => 
      train.origin === origin && 
      train.destination === destination && 
      train.date === date
    );

    if (filtered.length > 0) {
      staticCache.set(cacheKey, filtered);
      console.log(`[twTraData] L1 靜態數據載入完成，共 ${filtered.length} 班車`);
      return filtered;
    }

    // 日期不匹配時的降級 (同路線資料作為示範)
    const fallback = staticData.filter(train =>
      train.origin === origin &&
      train.destination === destination
    ).map(train => ({
      ...train,
      date
    }));

    staticCache.set(cacheKey, fallback);
    console.log(`[twTraData] L1 使用同路線資料降級，共 ${fallback.length} 班車`);
    return fallback;
  } catch (err) {
    console.error(`[twTraData] L1 靜態數據讀取失敗:`, err.message);
    return [];
  }
}

/**
 * 從 PTX API 取得台鐵班次完整資訊（含誤點）
 * PTX 公共運輸整合平台：https://ptx.transportdata.tw/
 */
async function fetchFromPTX(origin, destination, date) {
  try {
    if (!CONFIG.TDX_API_KEY) {
      console.warn('[twTraData] PTX API Key 未設置，將使用本地快取');
      return null;
    }

    // PTX API 格式: /Rail/TRA/ScheduleBoard/{StationID}/[{DestinationStationID}]
    // 需先正規化為 PTX 站碼
    const ptxOriginCode = getPTXStationCode(origin);
    const ptxDestCode = getPTXStationCode(destination);

    if (!ptxOriginCode || !ptxDestCode) {
      console.warn('[twTraData] 無法轉換為 PTX 站碼');
      return null;
    }

    const url = `${CONFIG.TDX_ENDPOINT}/Rail/TRA/ScheduleBoard/${ptxOriginCode}/${ptxDestCode}?$format=JSON`;
    
    console.log(`[twTraData] 呼叫 PTX API: ${url}`);

    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${CONFIG.TDX_API_KEY}`
      }
    });

    if (!response.ok) {
      console.warn(`[twTraData] PTX API 回應異常: ${response.status}`);
      return null;
    }

    const data = await response.json();
    
    // 轉換 PTX 格式為內部格式
    const trains = data.map(item => ({
      trainNumber: item.TrainNo,
      trainType: item.TrainTypeName || '',
      departureTime: item.DepTime,
      arrivalTime: item.ArrTime,
      duration: calculateDuration(item.DepTime, item.ArrTime),
      price: item.TicketPrice || 0,
      delay: item.Delay || 0,
      stops: item.StopCount || 0
    }));

    return trains;
  } catch (err) {
    console.error(`[twTraData] PTX API 呼叫失敗:`, err.message);
    return null;
  }
}

/**
 * 轉換車站名稱為 PTX 站碼
 */
function getPTXStationCode(stationName) {
  const ptxStationMap = {
    "臺北": "1000",
    "板橋": "1001",
    "新竹": "1004",
    "中壢": "1006",
    "桃園": "1003",
    "竹北": "1005",
    "臺中": "2000",
    "高雄": "3000",
    "花蓮": "4000"
  };
  
  return ptxStationMap[stationName] || null;
}

/**
 * 從 TDX API 取得即時誤點資訊（L2）
 * 實作簡化版本，實際應透過 TDX API 取得
 */
async function fetchDynamicDelayInfo(trainNumbers) {
  if (!trainNumbers || trainNumbers.length === 0) {
    return {};
  }
  
  const cacheKey = `delay_${trainNumbers.join('_')}`;
  let cached = dynamicCache.get(cacheKey);
  
  if (cached) {
    console.log(`[twTraData] L2 快取命中: ${cacheKey}`);
    return cached;
  }
  
  try {
    // 此處為簡化示例，實際應調用 TDX API
    // 在實務中，這裡會透過 TDX 認證並查詢 GeneralTrainInfo
    const delayMap = {};
    
    // 模擬：隨機某些班次有誤點
    trainNumbers.forEach(train => {
      // 隨機決定是否有誤點 (20% 機率)
      if (Math.random() < 0.2) {
        delayMap[train] = Math.floor(Math.random() * 10) + 1; // 1-10 分鐘誤點
      } else {
        delayMap[train] = 0;
      }
    });
    
    dynamicCache.set(cacheKey, delayMap);
    console.log(`[twTraData] L2 誤點資訊更新完成`);
    return delayMap;
  } catch (err) {
    console.error(`[twTraData] L2 TDX API 呼叫失敗:`, err.message);
    return {}; // 降級：回傳空誤點資訊
  }
}

/**
 * 比較時間字符串 (HH:mm)
 */
function compareTime(time1, time2) {
  const [h1, m1] = time1.split(':').map(Number);
  const [h2, m2] = time2.split(':').map(Number);
  const minutes1 = h1 * 60 + m1;
  const minutes2 = h2 * 60 + m2;
  return minutes1 - minutes2;
}

function getDepartureSortMinutes(train) {
  const [h, m] = String(train?.departureTime || '').split(':').map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return 0;
  return h * 60 + m + Number(train?.departureDayOffset || 0) * 24 * 60;
}

/**
 * 計算班次耗時
 */
function calculateDuration(depTime, arrTime) {
  try {
    const [depH, depM] = depTime.split(':').map(Number);
    const [arrH, arrM] = arrTime.split(':').map(Number);
    
    let depMin = depH * 60 + depM;
    let arrMin = arrH * 60 + arrM;
    
    // 處理跨日
    if (arrMin < depMin) {
      arrMin += 24 * 60;
    }
    
    const diff = arrMin - depMin;
    const hours = Math.floor(diff / 60);
    const minutes = diff % 60;
    
    if (hours === 0) {
      return `${minutes}m`;
    }
    return `${hours}h${minutes > 0 ? minutes + 'm' : ''}`;
  } catch (err) {
    return '計算中';
  }
}

/**
 * 從 PTX API 取得台鐵班次完整資訊（含誤點）
 * PTX 公共運輸整合平台：https://ptx.transportdata.tw/
 */
async function fetchFromPTX(origin, destination, date) {
  try {
    if (!CONFIG.TDX_API_KEY) {
      console.warn('[twTraData] PTX API Key 未設置，將使用本地快取');
      return null;
    }

    // PTX API 格式: /Rail/TRA/ScheduleBoard/{StationID}/[{DestinationStationID}]
    // 需先正規化為 PTX 站碼
    const ptxOriginCode = getPTXStationCode(origin);
    const ptxDestCode = getPTXStationCode(destination);

    if (!ptxOriginCode || !ptxDestCode) {
      console.warn('[twTraData] 無法轉換為 PTX 站碼');
      return null;
    }

    const url = `${CONFIG.TDX_ENDPOINT}/Rail/TRA/ScheduleBoard/${ptxOriginCode}/${ptxDestCode}?$format=JSON`;
    
    console.log(`[twTraData] 呼叫 PTX API: ${url}`);

    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${CONFIG.TDX_API_KEY}`
      }
    });

    if (!response.ok) {
      console.warn(`[twTraData] PTX API 回應異常: ${response.status}`);
      return null;
    }

    const data = await response.json();
    
    // 轉換 PTX 格式為內部格式
    const trains = data.map(item => ({
      trainNumber: item.TrainNo,
      trainType: item.TrainTypeName || '',
      departureTime: item.DepTime,
      arrivalTime: item.ArrTime,
      duration: calculateDuration(item.DepTime, item.ArrTime),
      price: item.TicketPrice || 0,
      delay: item.Delay || 0,
      stops: item.StopCount || 0
    }));

    return trains;
  } catch (err) {
    console.error(`[twTraData] PTX API 呼叫失敗:`, err.message);
    return null;
  }
}

/**
 * 轉換車站名稱為 PTX 站碼
 */
function getPTXStationCode(stationName) {
  const ptxStationMap = {
    "臺北": "1000",
    "板橋": "1001",
    "新竹": "1004",
    "中壢": "1006",
    "桃園": "1003",
    "竹北": "1005",
    "臺中": "2000",
    "高雄": "3000",
    "花蓮": "4000"
  };
  
  return ptxStationMap[stationName] || null;
}

/**
 * 主函式：搜尋火車班次
 */
async function searchTraTrains(params) {
  const { origin, destination, date, time, timeRange } = params;
  
  console.log('[twTraData] 收到查詢請求:', { origin, destination, date, time, timeRange });
  
  // ============ 驗證與正規化 ============
  
  // Rate Limit 檢查
  const rateCheck = checkRateLimit();
  if (!rateCheck.allowed) {
    console.warn('[twTraData] Rate Limit 超出');
    return {
      error: "RATE_LIMIT_EXCEEDED",
      message: "查詢次數暫時達到限制，請稍後再試。",
      remaining: 0
    };
  }
  
  // 正規化車站
  const normalizedOrigin = normalizeStationName(origin);
  const normalizedDestination = normalizeStationName(destination);
  
  if (!normalizedOrigin || !normalizedDestination) {
    console.warn('[twTraData] 無法識別的車站名稱:', { origin, destination });
    return {
      error: "INVALID_STATION",
      message: "無法識別的車站名稱。"
    };
  }
  
  // 日期預設為今天
  let queryDate = date;
  if (!queryDate) {
    queryDate = normalizeDateInput();
  } else if (!validateDate(queryDate)) {
    console.warn('[twTraData] 日期格式錯誤:', queryDate);
    return {
      error: "INVALID_DATE",
      message: "日期格式錯誤，應為 YYYY-MM-DD。"
    };
  } else {
    queryDate = normalizeDateInput(queryDate);
  }
  
  // 時間預設為現在
  let queryTime = time;
  if (!queryTime) {
    const now = new Date();
    queryTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  } else if (!validateTime(queryTime)) {
    console.warn('[twTraData] 時間格式錯誤:', queryTime);
    return {
      error: "INVALID_TIME",
      message: "時間格式錯誤，應為 HH:mm。"
    };
  }

  try {
    const officialResult = await queryTraTrains({
      origin,
      destination,
      date: queryDate,
      time: queryTime,
      timeRange,
      limit: 5
    });

    if (officialResult.error) {
      return officialResult;
    }

    if (Array.isArray(officialResult.data)) {
      console.log(`[twTraData] 官方資料鏈查詢成功 (${officialResult.dataSource})，回傳 ${officialResult.data.length} 班車`);
      return officialResult;
    }
  } catch (error) {
    console.warn('[twTraData] 官方資料鏈查詢失敗，準備進入舊 fallback:', error.message);
  }
  
  // ============ 優先嘗試 ODS JSON/XML，降級到 PTX / 本地快取 ============
  let schedules = null;
  let dataSource = 'local';
  let sourceUpdatedAt = new Date().toISOString();
  let resultOrigin = normalizedOrigin;
  let resultDestination = normalizedDestination;

  try {
    console.log('[twTraData] 嘗試使用 ODS JSON/XML 每日時刻表...');
    const odsResult = await searchOdsTrainSchedules({
      origin: normalizedOrigin,
      destination: normalizedDestination,
      date: queryDate
    });

    if (odsResult.error) {
      return odsResult;
    }

    schedules = odsResult.data;
    dataSource = odsResult.dataSource;
    sourceUpdatedAt = odsResult.updatedAt;
    resultOrigin = odsResult.origin;
    resultDestination = odsResult.destination;
  } catch (error) {
    console.warn('[twTraData] ODS 查詢失敗，準備降級:', error.message);
  }

  // ODS 失敗時才嘗試 PTX API（需要 API Key）
  if (!schedules && CONFIG.TDX_API_KEY) {
    console.log('[twTraData] 嘗試使用 PTX API...');
    schedules = await fetchFromPTX(normalizedOrigin, normalizedDestination, queryDate);
    if (schedules) {
      dataSource = 'PTX API';
      sourceUpdatedAt = new Date().toISOString();
    }
  }

  // 降級：使用本地快取
  if (!schedules) {
    console.log('[twTraData] 使用本地時刻表快取...');
    schedules = fetchStaticSchedule(normalizedOrigin, normalizedDestination, queryDate);
    dataSource = 'local';
    sourceUpdatedAt = new Date().toISOString();
  }
  
  if (schedules.length === 0) {
    console.warn('[twTraData] 查無時刻表資料:', { normalizedOrigin, normalizedDestination, queryDate });
    return {
      error: "NO_TRAINS_FOUND",
      message: "系統目前查無符合條件的車次，請確認站名或時間是否正確。",
      data: []
    };
  }
  
  // ============ 過濾符合時間的班次 ============
  let filteredSchedules = schedules;
  
  if (timeRange) {
    const range = parseTimeRange(timeRange);
    filteredSchedules = schedules.filter(train => {
      const comparison = compareTime(train.departureTime, range.start);
      const comparison2 = compareTime(train.departureTime, range.end);
      return Number(train.departureDayOffset || 0) === 0 && comparison >= 0 && comparison2 <= 0;
    });
  } else {
    // 只顯示未來的班次
    const queryMinutes = compareTime(queryTime, '00:00');
    filteredSchedules = schedules.filter(train => getDepartureSortMinutes(train) >= queryMinutes);
  }
  
  if (filteredSchedules.length === 0) {
    console.warn('[twTraData] 符合時間的班次為空');
    return {
      error: "NO_TRAINS_FOUND",
      message: "系統目前查無符合條件的車次，請確認站名或時間是否正確。",
      data: []
    };
  }
  
  // ============ L2: 動態誤點資訊疊加（若為本地快取） ============
  let enrichedSchedules = filteredSchedules;
  
  if (dataSource === 'local') {
    const trainNumbers = filteredSchedules.map(t => t.trainNumber);
    const delayMap = await fetchDynamicDelayInfo(trainNumbers);
    
    // 合併誤點資訊
    enrichedSchedules = filteredSchedules.map(train => ({
      ...train,
      delay: delayMap[train.trainNumber] || 0
    }));
  }
  
  // ============ 回傳前 3-5 班 ============
  const result = enrichedSchedules.slice(0, 5).map(train => ({
    trainNumber: train.trainNumber,
    trainType: train.trainType,
    departureTime: train.departureTime,
    arrivalTime: train.arrivalTime,
    departureDayOffset: train.departureDayOffset || 0,
    arrivalDayOffset: train.arrivalDayOffset || 0,
    duration: train.duration,
    price: train.price ?? null,
    fare: {
      amount: train.price ?? null,
      label: train.price == null ? '票價查無' : `$${train.price}`,
      source: 'fallback'
    },
    fareText: train.price == null ? '票價查無' : `$${train.price}`,
    delay: train.delay || 0,
    delayDisplay: train.delay > 0 ? `🟡 誤點 ${train.delay} 分` : '⚪ 無即時資料',
    stops: train.stops || 0,
    trainClassCode: train.trainClassCode || '',
    note: train.note || ''
  }));
  
  console.log(`[twTraData] 查詢成功 (${dataSource}），回傳 ${result.length} 班車`);
  
  return {
    success: true,
    origin: resultOrigin,
    destination: resultDestination,
    date: queryDate,
    queryTime: queryTime,
    timeRange: timeRange || null,
    data: result,
    count: result.length,
    dataSource: dataSource,
    updatedAt: sourceUpdatedAt || new Date().toISOString()
  };
}

// ============ 導出 ============
module.exports = {
  searchTraTrains,
  normalizeStationName,
  checkRateLimit,
  validateDate,
  validateTime,
  parseTimeRange,
  loadStationCodeMap,
  fetchDatasetSchedule,
  fetchFromPTX,
  getPTXStationCode,
  calculateDuration,
  staticCache,
  dynamicCache,
  rateLimitCache
};
