const { SlashCommandBuilder } = require('@discordjs/builders');
const { EmbedBuilder } = require('discord.js');
const { resolveStockInfo, fetchLatestStockNews } = require('../../utils/stockNews');
const { summarizeStockNewsWithAI } = require('../../utils/openaiClient');

function truncateText(text, maxLength) {
  const value = String(text || '').trim();
  if (value.length <= maxLength) return value;
  return `${value.slice(0, Math.max(0, maxLength - 1))}…`;
}

function buildNewsFieldValue(newsItems) {
  const lines = [];
  let totalLength = 0;

  for (let i = 0; i < newsItems.length; i += 1) {
    const item = newsItems[i];
    const safeTitle = truncateText(item.title, 90);
    const line = `${i + 1}. [${safeTitle}](${item.link})`;
    const nextLength = totalLength + line.length + 1;

    if (nextLength > 980) break;

    lines.push(line);
    totalLength = nextLength;
  }

  return lines.join('\n') || '目前暫無可顯示的新聞連結。';
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('stock_news')
    .setDescription('抓取指定台股最新新聞並產生 AI 摘要')
    .addStringOption(option =>
      option
        .setName('ticker')
        .setDescription('輸入台股代碼或代碼+名稱（例如 2330 或 2330 台積電）')
        .setRequired(true)
    )
    .addIntegerOption(option =>
      option
        .setName('count')
        .setDescription('抓取新聞數量（3-5）')
        .setMinValue(3)
        .setMaxValue(5)
        .setRequired(false)
    ),

  async execute(interaction) {
    await interaction.deferReply();

    const tickerInput = interaction.options.getString('ticker', true);
    const count = interaction.options.getInteger('count') || 5;

    let stockInfo;
    try {
      stockInfo = await resolveStockInfo(tickerInput);
    } catch (error) {
      console.error('[stock_news] 解析股票資訊失敗:', error);
      await interaction.editReply('目前無法解析該標的資訊，請稍後再試。');
      return;
    }

    let newsItems = [];
    try {
      newsItems = await fetchLatestStockNews(stockInfo, count);
    } catch (error) {
      console.error('[stock_news] 抓取新聞失敗:', error);
      await interaction.editReply('抓取新聞時發生錯誤，請稍後再試。');
      return;
    }

    if (!Array.isArray(newsItems) || newsItems.length === 0) {
      await interaction.editReply('目前暫無該標的的最新新聞。');
      return;
    }

    let summaryText = 'AI 摘要暫時不可用，請先參考下方新聞連結。';
    try {
      summaryText = await summarizeStockNewsWithAI({
        stockLabel: `${stockInfo.code} ${stockInfo.name}`,
        newsItems,
        maxChars: 500
      });
    } catch (error) {
      console.error('[stock_news] AI 摘要失敗:', error);
    }

    const newsFieldValue = buildNewsFieldValue(newsItems);
    const finalSummary = truncateText(summaryText, 500);

    const embed = new EmbedBuilder()
      .setColor(0x0ea5e9)
      .setTitle(`${stockInfo.code || stockInfo.symbol} ${stockInfo.name} 最新新聞`) 
      .setDescription('以下為近期新聞與 AI 重點摘要。')
      .addFields(
        { name: '新聞連結', value: newsFieldValue, inline: false },
        { name: 'AI 摘要報告', value: finalSummary || '暫無摘要內容。', inline: false },
        { name: '免責聲明', value: '本資訊僅供參考，不構成投資建議。', inline: false }
      )
      .setTimestamp(new Date());

    await interaction.editReply({ embeds: [embed] });
  }
};
