const { timeToMinutes } = require('./odsScheduleService');

function formatMinutesAsTime(totalMinutes) {
  const normalized = ((totalMinutes % 1440) + 1440) % 1440;
  const hours = Math.floor(normalized / 60);
  const minutes = normalized % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function addDelayToTime(time, dayOffset, delayMinutes) {
  const base = timeToMinutes(time);
  if (!Number.isFinite(base)) return null;
  const total = base + Number(dayOffset || 0) * 1440 + Number(delayMinutes || 0);
  return {
    time: formatMinutesAsTime(total),
    dayOffset: Math.floor(total / 1440)
  };
}

function mergeStaticWithRealtime(staticTrains, realtimeResult) {
  const trains = staticTrains.map(train => {
    const live = realtimeResult?.byTrainNo?.get(String(train.trainNumber));
    const delayMinutes = live ? Number(live.delayTime || 0) : null;
    const estimated = delayMinutes == null
      ? null
      : addDelayToTime(train.departureTime, train.departureDayOffset, delayMinutes);

    return {
      ...train,
      delay: delayMinutes == null ? 0 : delayMinutes,
      hasRealtime: !!live,
      delayDisplay: live ? (delayMinutes > 0 ? `🟡 誤點 ${delayMinutes} 分` : '🟢 準點') : '⚪ 無即時資料',
      realtimeStatus: live?.status ?? null,
      realtimeStationId: live?.stationId || '',
      realtimeStationName: live?.stationName || '',
      trainLocation: live?.trainLocation ?? '',
      estimatedDepartureTime: estimated?.time || null,
      estimatedDepartureDayOffset: estimated?.dayOffset ?? train.departureDayOffset
    };
  });

  const hasRealtime = trains.some(train => train.hasRealtime);
  return {
    trains,
    hasRealtime,
    realtimeUpdatedAt: realtimeResult?.updatedAt || null,
    realtimeUnavailableReason: realtimeResult?.ok === false ? realtimeResult.reason : ''
  };
}

function mergeFares(trains, fareResult) {
  return trains.map(train => {
    const fare = fareResult?.byTrainNo?.get(String(train.trainNumber));
    return {
      ...train,
      price: fare?.price ?? null,
      fare: fare?.fare || {
        amount: null,
        label: '票價查無',
        source: 'TDX_ODFare'
      },
      fareText: fare?.fare?.label || fare?.fareText || '票價查無',
      fareSource: fare?.fareSource || 'TDX ODFare',
      fareCategory: fare?.fareCategory || null,
      fareTrainType: fare?.fareTrainType || null
    };
  });
}

module.exports = {
  mergeStaticWithRealtime,
  mergeFares
};
