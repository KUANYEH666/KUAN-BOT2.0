const { searchOdsTrainSchedules } = require('./odsScheduleService');

async function getDailyStaticSchedule({ origin, destination, date }) {
  const result = await searchOdsTrainSchedules({ origin, destination, date });
  if (result.error) {
    return result;
  }

  return {
    ...result,
    scheduleSource: result.dataSource,
    hasStaticSchedule: true
  };
}

module.exports = {
  getDailyStaticSchedule
};
