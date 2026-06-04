/**
 * src/commands/tools/train.js
 * 台鐵時刻表查詢斜線指令
 * Layer 3: 指令層 (UI 版本)
 */

const { SlashCommandBuilder } = require('discord.js');
const { searchTraTrains } = require('../../utils/twTraData');
const { buildTrainEmbed } = require('../../utils/trainSchedule/traTrainFormatter');
const { resolveTrainQueryDate } = require('../../utils/trainSchedule/traDateResolver');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('train')
    .setDescription('🚆 查詢台鐵時刻表與即時誤點資訊')
    .addStringOption(option =>
      option
        .setName('出發站')
        .setDescription('例：北車、台北、台中')
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName('抵達站')
        .setDescription('例：台中、高雄、花蓮')
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName('日期')
        .setDescription('YYYY-MM-DD 或 YYYYMMDD 格式，留空為今天')
        .setRequired(false)
    )
    .addStringOption(option =>
      option
        .setName('時間')
        .setDescription('HH:mm 格式，留空為現在')
        .setRequired(false)
    )
    .addStringOption(option =>
      option
        .setName('時段')
        .setDescription('預設時段搜尋（可不選）')
        .setRequired(false)
        .addChoices(
          { name: '☀️ 早上 (06:00-12:00)', value: 'morning' },
          { name: '🌤️ 下午 (12:00-17:00)', value: 'afternoon' },
          { name: '🌅 傍晚 (17:00-20:00)', value: 'evening' },
          { name: '🌙 晚上 (20:00-23:59)', value: 'night' }
        )
    ),

  async execute(interaction) {
    // 延遲回應，防止超時
    await interaction.deferReply();

    try {
      // 收集參數
      const params = {
        origin: interaction.options.getString('出發站'),
        destination: interaction.options.getString('抵達站'),
        date: interaction.options.getString('日期'),
        time: interaction.options.getString('時間'),
        timeRange: interaction.options.getString('時段')
      };
      const dateResolution = resolveTrainQueryDate({
        userText: params.date || '',
        llmDate: params.date
      });
      params.date = dateResolution.queryDate;
      console.log('[train.js] 日期校正:', {
        inputDate: dateResolution.originalDate,
        queryDate: dateResolution.queryDate,
        reason: dateResolution.reason
      });

      console.log(`[train.js] 查詢參數:`, params);

      // 呼叫查詢函式
      const result = await searchTraTrains(params);

      // 錯誤處理
      if (result.error) {
        return await interaction.editReply({
          content: `❌ ${result.message}`,
          ephemeral: true
        });
      }

      const embed = buildTrainEmbed(result);

      return await interaction.editReply({ embeds: [embed] });

    } catch (err) {
      console.error('[train.js] 執行錯誤:', err);
      return await interaction.editReply({
        content: `⚠️ 查詢過程中發生錯誤：${err.message}`,
        ephemeral: true
      });
    }
  }
};
