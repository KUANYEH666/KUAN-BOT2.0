const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const { scanBreakoutStocks, getStockBreakoutCache } = require('../../utils/stockBreakoutWorker');
const { getTickerCountWithMinBars } = require('../../utils/stockDb');

const adminIds = process.env.ADMINS?.split(',') || [];

module.exports = {
  data: new SlashCommandBuilder()
    .setName('twstock_refresh_cache')
    .setDescription('手動更新台股低位爆量突破快取（限管理員）')
    .setDMPermission(false),

  async execute(interaction) {
    if (!adminIds.includes(interaction.user.id)) {
      await interaction.reply({
        content: '❌ 你沒有權限使用這個指令。',
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    try {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    } catch (error) {
      if (error?.code === 10062) {
        return;
      }
      throw error;
    }

    try {
      const lookbackDays = 30;
      const minBarsRequired = 31;
      const readyTickerCount = getTickerCountWithMinBars(minBarsRequired);

      if (readyTickerCount === 0) {
        const seedEmbed = new EmbedBuilder()
          .setColor(0xf59e0b)
          .setTitle('歷史資料不足')
          .setDescription('目前資料庫尚未完成初始化，無法計算低位爆量突破策略。')
          .addFields(
            { name: '建議處理方式', value: '請先在主機執行 npm run seed:twstock，完成後再重試此指令。', inline: false },
            { name: '策略回看天數', value: String(lookbackDays), inline: true },
            { name: '最低需求K棒', value: String(minBarsRequired), inline: true }
          );

        await interaction.editReply({ embeds: [seedEmbed] });
        return;
      }

      const cache = await scanBreakoutStocks();
      const successEmbed = new EmbedBuilder()
        .setColor(0x10b981)
        .setTitle('快取更新完成')
        .setDescription('台股低位爆量突破快取已手動更新成功。')
        .addFields(
          { name: '策略回看天數', value: String(cache?.lookbackDays || lookbackDays), inline: true },
          { name: '符合條件數量', value: String(cache?.matchedCount || 0), inline: true },
          { name: '掃描母池數量', value: String(cache?.sourceStockCount || 0), inline: true },
          { name: '全市場模式', value: cache?.fullMarketMode ? '開啟' : '關閉', inline: true },
          { name: '更新時間', value: cache?.updatedAt ? `<t:${Math.floor(new Date(cache.updatedAt).getTime() / 1000)}:F>` : '未知', inline: false }
        );

      await interaction.editReply({ embeds: [successEmbed] });
    } catch (error) {
      if (error?.code === 10062) {
        return;
      }

      if (error?.code === 'MARKET_DATA_WAITING') {
        const waitingEmbed = new EmbedBuilder()
          .setColor(0xf59e0b)
          .setTitle('資料尚未更新')
          .setDescription('證交所或櫃買中心今日資料尚未發布，請稍後再試。')
          .addFields({
            name: '交易日',
            value: error?.tradingDate || '未知',
            inline: true
          });

        await interaction.editReply({ embeds: [waitingEmbed] });
        return;
      }

      const { cachePath } = getStockBreakoutCache();
      console.error('[twstock_breakout] 手動更新失敗:', error);

      const errorEmbed = new EmbedBuilder()
        .setColor(0xef4444)
        .setTitle('快取更新失敗')
        .setDescription('手動更新時發生錯誤，請稍後再試或檢查主控台。')
        .addFields({ name: '快取路徑', value: cachePath || '未知', inline: false });

      await interaction.editReply({ embeds: [errorEmbed] });
    }
  }
};
