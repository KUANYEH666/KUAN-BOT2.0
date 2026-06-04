const { EmbedBuilder } = require('discord.js');

const TYPE_EMOJI = {
  '普悠瑪': '🔴',
  '太魯閣': '🔴',
  '自強': '🔴',
  '區間快': '🔵',
  '復興': '🔵',
  '莒光號': '🟠',
  '平快': '🟠',
  '區間車': '🟠'
};

const DISCLAIMER = '即時資訊可能有延遲，實際乘車仍以臺鐵官方與車站現場資訊為準。';
const TIME_RANGE_LABELS = {
  morning: '早上',
  afternoon: '下午',
  evening: '傍晚',
  night: '晚上'
};

function getQueryTimeLabel(result) {
  if (result.timeRange && TIME_RANGE_LABELS[result.timeRange]) {
    return `時段：${TIME_RANGE_LABELS[result.timeRange]}`;
  }
  return `⏰ 自 ${result.queryTime} 起`;
}

function formatDayBadge(dayOffset) {
  return Number(dayOffset || 0) > 0 ? `(+${dayOffset})` : '';
}

function getFareText(train) {
  return train.fare?.label || '票價查無';
}

function getDelayText(train) {
  if (train.delayDisplay) return train.delayDisplay;
  if (train.hasRealtime) {
    return train.delay > 0 ? `🟡 誤點 ${train.delay} 分` : '🟢 準點';
  }
  return '⚪ 無即時資料';
}

function getEstimatedDepartureText(train) {
  if (!train.estimatedDepartureTime) return '無即時資料';
  return `${train.estimatedDepartureTime}${formatDayBadge(train.estimatedDepartureDayOffset)}`;
}

function getRealtimeStatusText(train) {
  if (!train.hasRealtime) return '無即時資料';
  return `${train.realtimeStatus ?? '未知'}${train.realtimeStationName ? `｜${train.realtimeStationName}` : ''}`;
}

function formatTrainFieldValue(train) {
  const departureDayBadge = formatDayBadge(train.departureDayOffset);
  const arrivalDayBadge = formatDayBadge(train.arrivalDayOffset);

  return `${TYPE_EMOJI[train.trainType] || '⚪'} **${train.departureTime}${departureDayBadge} ➔ ${train.arrivalTime}${arrivalDayBadge}**\n`
    + `車次：${train.trainNumber} ${train.trainType}\n`
    + `耗時：⏱️ ${train.duration} | 💰 ${getFareText(train)} | ${getDelayText(train)}\n`
    + `停靠：${train.stops} 站\n`
    + `預估出發：${getEstimatedDepartureText(train)}\n`
    + `即時狀態：${getRealtimeStatusText(train)}`;
}

function buildTrainEmbed(result) {
  const embed = new EmbedBuilder()
    .setColor('#FFD700')
    .setTitle(`🚉 ${result.origin} ➡️ ${result.destination}`)
    .setDescription([
      `📅 **${result.date}** | ${getQueryTimeLabel(result)}`,
      result.hasRealtime ? '已合併 TDX 即時列車動態資料。' : '目前無即時誤點資料，以下為排定時刻表。'
    ].join('\n'))
    .setFooter({
      text: `資料來源：${result.dataSource || '未知'}｜更新時間：${new Date(result.updatedAt).toLocaleString('zh-TW')}｜${DISCLAIMER}`
    });

  if (!Array.isArray(result.data) || result.data.length === 0) {
    embed.addFields({
      name: '查詢結果',
      value: '系統目前查無符合條件的車次，請確認站名或時間是否正確。',
      inline: false
    });
  } else {
    result.data.forEach((train, idx) => {
      embed.addFields({
        name: `${idx + 1}. ${train.trainType}`,
        value: formatTrainFieldValue(train),
        inline: false
      });
    });
  }

  embed.addFields({
    name: '💡 說明',
    value: `🔴 紅色：快速列車（普悠瑪、太魯閣、自強）\n🔵 藍色：中速列車（區間快、復興）\n🟠 橙色：普通列車（莒光號、平快、區間車）\n${DISCLAIMER}`,
    inline: false
  });

  return embed;
}

function formatTrainText(result) {
  if (!Array.isArray(result.data) || result.data.length === 0) {
    return '系統目前查無符合條件的車次，請確認站名或時間是否正確。';
  }

  const lines = [
    `🚉 **${result.origin} ➡️ ${result.destination}** | 📅 ${result.date} | ${getQueryTimeLabel(result)}`,
    result.hasRealtime ? '已合併 TDX 即時列車動態資料。' : '目前無即時誤點資料，以下為排定時刻表。',
    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'
  ];

  result.data.forEach((train, idx) => {
    lines.push(`**${idx + 1}. ${train.trainType} ${train.trainNumber}**`);
    lines.push(formatTrainFieldValue(train));
  });

  lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  lines.push(`資料來源：${result.dataSource || '未知'}｜更新時間：${new Date(result.updatedAt).toLocaleString('zh-TW')}`);
  lines.push(DISCLAIMER);

  return lines.join('\n');
}

module.exports = {
  buildTrainEmbed,
  formatTrainText,
  formatTrainFieldValue
};
