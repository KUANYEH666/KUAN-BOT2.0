const { getDailyStaticSchedule } = require('./traStaticScheduleSource');
const { getRealtimeByTrainNumbers } = require('./traRealtimeSource');
const { mergeStaticWithRealtime, mergeFares } = require('./traScheduleMerger');
const { getFareMapForTrains } = require('./traFareSource');
const { normalizeDateInput, timeToMinutes } = require('./odsScheduleService');

function parseTimeRange(timeRange) {
  const ranges = {
    morning: { start: '06:00', end: '12:00' },
    afternoon: { start: '12:00', end: '17:00' },
    evening: { start: '17:00', end: '20:00' },
    night: { start: '20:00', end: '23:59' },
    all: { start: '00:00', end: '23:59' }
  };
  return ranges[String(timeRange || '').toLowerCase()] || ranges.all;
}

function getDepartureSortMinutes(train) {
  const base = timeToMinutes(train.departureTime);
  if (!Number.isFinite(base)) return 0;
  return base + Number(train.departureDayOffset || 0) * 1440;
}

function filterByTime(trains, queryTime, timeRange) {
  if (timeRange) {
    const range = parseTimeRange(timeRange);
    const start = timeToMinutes(range.start);
    const end = timeToMinutes(range.end);
    return trains.filter(train => {
      if (Number(train.departureDayOffset || 0) !== 0) return false;
      const dep = timeToMinutes(train.departureTime);
      return dep >= start && dep <= end;
    });
  }

  const queryMinutes = timeToMinutes(queryTime);
  return trains.filter(train => getDepartureSortMinutes(train) >= queryMinutes);
}

function nowTaipeiTime() {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Taipei',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).formatToParts(new Date());
  const byType = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${byType.hour}:${byType.minute}`;
}

async function queryTraTrains(params) {
  const queryDate = normalizeDateInput(params?.date);
  const queryTime = params?.time || nowTaipeiTime();

  const staticResult = await getDailyStaticSchedule({
    origin: params.origin,
    destination: params.destination,
    date: queryDate
  });

  if (staticResult.error) return staticResult;

  const candidates = filterByTime(staticResult.data, queryTime, params?.timeRange);
  const displayCandidates = candidates.slice(0, Number(params?.limit || 5));
  console.log(`[twTraData] ODS base trains found: ${displayCandidates.length}`);
  const trainNumbers = displayCandidates.map(train => train.trainNumber);
  const firstTrain = displayCandidates[0];
  console.log('[twTraData] start fare enrichment');
  console.log(`[twTraData] originStationId=${firstTrain?.originStationId || ''}`);
  console.log(`[twTraData] destinationStationId=${firstTrain?.destinationStationId || ''}`);
  const fareResult = firstTrain
    ? await getFareMapForTrains({
      originStationId: firstTrain.originStationId,
      destinationStationId: firstTrain.destinationStationId,
      trains: displayCandidates
    })
    : {
      ok: false,
      reason: 'No trains to price.',
      byTrainNo: new Map(),
      updatedAt: new Date().toISOString()
    };
  const pricedBaseTrains = mergeFares(displayCandidates, fareResult);
  console.log('[twTraData] fare enrichment done');
  const realtime = await getRealtimeByTrainNumbers(trainNumbers, queryDate);
  const merged = mergeStaticWithRealtime(pricedBaseTrains, realtime);

  const dataSource = merged.hasRealtime
    ? 'TDX 即時資料 + TRA 每日時刻表'
    : `${staticResult.scheduleSource || staticResult.dataSource || 'TRA 每日時刻表'}（目前無即時誤點資料）`;

  return {
    success: true,
    origin: staticResult.origin,
    destination: staticResult.destination,
    date: queryDate,
    queryTime,
    timeRange: params?.timeRange || null,
    data: merged.trains,
    count: merged.trains.length,
    dataSource,
    staticDataSource: staticResult.scheduleSource || staticResult.dataSource,
    realtimeDataSource: merged.hasRealtime ? 'TDX TrainLiveBoard' : null,
    fareDataSource: fareResult.ok ? 'TDX ODFare' : null,
    hasRealtime: merged.hasRealtime,
    realtimeUnavailableReason: merged.realtimeUnavailableReason,
    fareUnavailableReason: fareResult.ok === false ? fareResult.reason : '',
    updatedAt: merged.realtimeUpdatedAt || staticResult.updatedAt || new Date().toISOString(),
    staticUpdatedAt: staticResult.updatedAt,
    realtimeUpdatedAt: merged.realtimeUpdatedAt,
    fareUpdatedAt: fareResult.updatedAt || null
  };
}

module.exports = {
  queryTraTrains,
  filterByTime
};
