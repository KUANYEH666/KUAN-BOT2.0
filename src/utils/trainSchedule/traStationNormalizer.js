const { normalizeStation } = require('./odsScheduleService');

function normalizeTraStation(input) {
  return normalizeStation(input);
}

module.exports = {
  normalizeTraStation
};
