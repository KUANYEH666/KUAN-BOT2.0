const { SlashCommandBuilder } = require('@discordjs/builders');
const { MessageFlags } = require('discord.js');
const { getStockBreakoutCache } = require('../../utils/stockBreakoutWorker');

function normalizeSymbol(symbol) {
  return String(symbol || '').replace(/\.(TW|TWO)$/i, '');
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('twstock_breakout_codes')
    .setDescription('一次輸出低位爆量突破清單股票代號')
    .addIntegerOption(option =>
      option
        .setName('scan_count')
        .setDescription('輸出幾檔（1-200）')
        .setMinValue(1)
        .setMaxValue(200)
        .setRequired(false)
    ),

  async execute(interaction) {
    const requestedCount = interaction.options.getInteger('scan_count') || 25;
    const { cache, isScanRunning } = getStockBreakoutCache();

    if (!cache) {
      await interaction.reply({
        content: '資料尚未建立，請先執行 /twstock_refresh_cache。',
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    if (isScanRunning) {
      await interaction.reply({
        content: '背景掃描正在更新中，請稍後再試。',
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    const matchedStocks = Array.isArray(cache.matchedStocks) ? cache.matchedStocks : [];
    if (matchedStocks.length === 0) {
      await interaction.reply({
        content: '目前沒有符合條件的標的。',
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    const displayCount = Math.min(requestedCount, matchedStocks.length);
    const codes = matchedStocks
      .slice(0, displayCount)
      .map(item => normalizeSymbol(item.symbol))
      .filter(Boolean)
      .join(' ');

    await interaction.reply({
      content: `突破代號（前 ${displayCount} 檔）：\n${codes}`
    });
  }
};
