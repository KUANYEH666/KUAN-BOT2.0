const { SlashCommandBuilder } = require('@discordjs/builders');
const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  StringSelectMenuBuilder
} = require('discord.js');
const { getStockBreakoutCache } = require('../../utils/stockBreakoutWorker');
const { getDistinctTickersByDate } = require('../../utils/stockDb');
const { resolveStockInfo, fetchLatestStockNews } = require('../../utils/stockNews');
const { getNewsSummary } = require('../../utils/openaiClient');

const BREAKOUT_BUTTON_PREFIX = 'twstock_breakout';

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function getTickerCode(symbol) {
  return String(symbol || '').replace(/\.(TW|TWO)$/i, '');
}

function buildKlineUrl(symbol) {
  const code = getTickerCode(symbol);
  return code ? `https://histock.tw/stock/${encodeURIComponent(code)}` : 'https://histock.tw/';
}

function buildSyntheticCandles(snapshot) {
  const close = Array.isArray(snapshot?.close) ? snapshot.close : [];
  const candles = [];

  for (let i = 0; i < close.length; i += 1) {
    const c = toNumber(close[i], 0);
    const prev = i > 0 ? toNumber(close[i - 1], c) : c;
    const o = prev;
    const h = Math.max(o, c) * 1.006;
    const l = Math.min(o, c) * 0.994;
    candles.push({
      o: Number(o.toFixed(2)),
      h: Number(h.toFixed(2)),
      l: Number(l.toFixed(2)),
      c: Number(c.toFixed(2))
    });
  }

  return candles;
}

function buildPriceStats(stock) {
  const snapshot = stock?.chartSnapshot || {};
  const closes = Array.isArray(snapshot.close) ? snapshot.close : [];
  const lastClose = closes.length > 0 ? toNumber(closes[closes.length - 1], toNumber(stock?.lastClose, 0)) : toNumber(stock?.lastClose, 0);
  const prevClose = closes.length > 1 ? toNumber(closes[closes.length - 2], lastClose) : lastClose;
  const open = prevClose;
  const high = Math.max(open, lastClose) * 1.006;
  const low = Math.min(open, lastClose) * 0.994;

  const change = lastClose - prevClose;
  const changePct = prevClose !== 0 ? (change / prevClose) * 100 : 0;

  return {
    open,
    high,
    low,
    close: lastClose,
    change,
    changePct
  };
}

function formatSigned(value, digits = 2) {
  const num = toNumber(value, 0);
  const fixed = Math.abs(num).toFixed(digits);
  return `${num >= 0 ? '+' : '-'}${fixed}`;
}

function buildStockEmbed(cache, stock, pageIndex, displayCount, matchedCount) {
  const healthColor = stock.healthColor || '#808080';
  const healthText = stock.healthText || '基本面資料暫無';
  const stats = buildPriceStats(stock);
  const volumeRatio = toNumber(stock.volumeRatio, 0);
  const avgVolume30 = Number(stock.avgVolume30 || 0).toLocaleString('zh-TW');
  const breakoutTag = stock.breakoutTag || '30日首度突破';

  return new EmbedBuilder()
    .setColor(healthColor)
    .setTitle(`${stock.symbol || '未知'} - ${stock.name || '未知'}`)
    .addFields(
      { name: '策略訊號', value: breakoutTag, inline: false },
      { name: '量能比', value: `${volumeRatio.toFixed(1)} 倍`, inline: true },
      { name: '30日平均量', value: avgVolume30, inline: true },
      { name: '變動', value: `${formatSigned(stats.change)} (${formatSigned(stats.changePct)}%)`, inline: false },
      {
        name: '價格資訊',
        value: `開盤：${stats.open.toFixed(2)}  最高：${stats.high.toFixed(2)}  成交量：${Number(stock.volume || 0).toLocaleString('zh-TW')}\n收盤：${stats.close.toFixed(2)}  最低：${stats.low.toFixed(2)}`,
        inline: false
      },
      { name: '更新日期', value: stock.breakoutDate || cache.tradingDate || '未知', inline: false },
      { name: '企業健康檢查', value: healthText, inline: false }
    )
    .setFooter({ text: `第 ${pageIndex + 1} / ${displayCount} 檔（符合總數 ${matchedCount}）` });
}

function buildPageButtons(currentIndex, displayCount, userId, symbol) {
  const previousId = `${BREAKOUT_BUTTON_PREFIX}:prev:${currentIndex}:${displayCount}:${userId}`;
  const nextId = `${BREAKOUT_BUTTON_PREFIX}:next:${currentIndex}:${displayCount}:${userId}`;
  const newsId = `${BREAKOUT_BUTTON_PREFIX}:news:${currentIndex}:${displayCount}:${userId}`;

  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(previousId)
      .setLabel('上一頁')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(displayCount <= 1),
    new ButtonBuilder()
      .setCustomId(nextId)
      .setLabel('下一頁')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(displayCount <= 1),
    new ButtonBuilder()
      .setCustomId(newsId)
      .setLabel('查看新聞摘要')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setLabel('查看K線圖')
      .setStyle(ButtonStyle.Link)
      .setURL(buildKlineUrl(symbol))
  );
}

function buildStockSelectMenu(currentIndex, displayCount, userId, matchedStocks) {
  const customId = `${BREAKOUT_BUTTON_PREFIX}:select:${displayCount}:${userId}`;
  const options = matchedStocks
    .slice(0, displayCount)
    .slice(0, 25)
    .map((stock, idx) => ({
      label: `${idx + 1}. ${stock.symbol}`,
      description: String(stock.name || stock.symbol).slice(0, 100),
      value: String(idx),
      default: idx === currentIndex
    }));

  const menu = new StringSelectMenuBuilder()
    .setCustomId(customId)
    .setPlaceholder('下拉選擇要查看的股票')
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(options);

  return new ActionRowBuilder().addComponents(menu);
}

function parseButtonId(customId) {
  const parts = String(customId || '').split(':');
  if (parts.length !== 5) return null;

  const [prefix, action, indexRaw, countRaw, userId] = parts;
  if (prefix !== BREAKOUT_BUTTON_PREFIX) return null;
  if (action !== 'prev' && action !== 'next' && action !== 'news') return null;

  const index = Number(indexRaw);
  const displayCount = Number(countRaw);
  if (!Number.isInteger(index) || !Number.isInteger(displayCount)) return null;

  return { action, index, displayCount, userId };
}

function truncateText(text, maxLength = 350) {
  const content = String(text || '').trim();
  if (content.length <= maxLength) return content;
  return `${content.slice(0, Math.max(0, maxLength - 1))}…`;
}

function buildNewsLinks(items) {
  const lines = [];

  for (let i = 0; i < items.length; i += 1) {
    const title = String(items[i]?.title || '').trim();
    const link = String(items[i]?.link || '').trim();
    if (!title || !link) continue;

    const safeTitle = truncateText(title, 80);
    lines.push(`${i + 1}. [${safeTitle}](${link})`);
  }

  const text = lines.join('\n');
  return truncateText(text, 1000) || '目前暫無相關即時新聞資訊。';
}

function parseSelectId(customId) {
  const parts = String(customId || '').split(':');
  if (parts.length !== 4) return null;

  const [prefix, type, countRaw, userId] = parts;
  if (prefix !== BREAKOUT_BUTTON_PREFIX || type !== 'select') return null;

  const displayCount = Number(countRaw);
  if (!Number.isInteger(displayCount)) return null;

  return { displayCount, userId };
}

async function renderBreakoutView(interaction, cache, matchedStocks, displayCount, selectedIndex, userId, mode = 'reply') {
  const safeIndex = Math.max(0, Math.min(selectedIndex, displayCount - 1));
  const stock = matchedStocks[safeIndex];
  const embed = buildStockEmbed(cache, stock, safeIndex, displayCount, matchedStocks.length);
  const pageRow = buildPageButtons(safeIndex, displayCount, userId, stock.symbol);
  const selectRow = buildStockSelectMenu(safeIndex, displayCount, userId, matchedStocks);
  embed.setImage(null);

  const payload = {
    embeds: [embed],
    components: [selectRow, pageRow]
  };

  if (mode === 'update') {
    await interaction.update(payload);
  } else {
    await interaction.editReply(payload);
  }
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('twstock_breakout')
    .setDescription('讀取台股低位爆量突破預掃描結果')
    .addIntegerOption(option =>
      option
        .setName('scan_count')
        .setDescription('顯示幾檔結果（1-25）')
        .setMinValue(1)
        .setMaxValue(25)
        .setRequired(false)
    ),

  async execute(interaction) {
    await interaction.deferReply();

    const requestedCount = interaction.options.getInteger('scan_count');
    const { cache, isScanRunning } = getStockBreakoutCache();

    if (!cache) {
      const loadingEmbed = new EmbedBuilder()
        .setColor(0xf59e0b)
        .setTitle('資料準備中')
        .setDescription('台股低位爆量突破清單尚未建立完成，請稍後再試。');

      await interaction.editReply({ embeds: [loadingEmbed] });
      return;
    }

    if (isScanRunning && (!cache.matchedStocks || cache.matchedStocks.length === 0)) {
      const runningEmbed = new EmbedBuilder()
        .setColor(0xf59e0b)
        .setTitle('資料更新中')
        .setDescription('背景掃描正在更新資料，請稍後再試。');

      await interaction.editReply({ embeds: [runningEmbed] });
      return;
    }

    const matchedStocks = Array.isArray(cache.matchedStocks) ? cache.matchedStocks : [];

    let viewStocks = matchedStocks;
    let displayCount = 0;

    if (requestedCount != null) {
      displayCount = Math.min(requestedCount, matchedStocks.length);
    } else {
      const processingEmbed = new EmbedBuilder()
        .setColor(0x3b82f6)
        .setTitle('全盤掃描中')
        .setDescription('正在整理今日可掃描標的，請稍候...');

      await interaction.editReply({ embeds: [processingEmbed], components: [] });

      const allTickers = getDistinctTickersByDate(cache.tradingDate);
      const matchedMap = new Map(matchedStocks.map(stock => [stock.symbol, stock]));
      const matchedTickerSet = new Set();

      const batchSize = 10;
      for (let i = 0; i < allTickers.length; i += batchSize) {
        const batch = allTickers.slice(i, i + batchSize);
        for (const ticker of batch) {
          const stock = matchedMap.get(ticker);
          if (stock) {
            matchedTickerSet.add(ticker);
          }
        }

        const processedCount = Math.min(i + batch.length, allTickers.length);
        const progressPercent = allTickers.length > 0
          ? ((processedCount / allTickers.length) * 100).toFixed(0)
          : '100';

        if (processedCount === allTickers.length || processedCount % 200 === 0) {
          const progressEmbed = new EmbedBuilder()
            .setColor(0x3b82f6)
            .setTitle('全盤掃描中')
            .setDescription('正在執行 30 日壓制後爆量突破比對，請稍候...')
            .addFields(
              { name: '處理進度', value: `${processedCount} / ${allTickers.length}（${progressPercent}%）`, inline: false },
              { name: '目前符合數', value: String(matchedTickerSet.size), inline: true }
            );

          await interaction.editReply({ embeds: [progressEmbed], components: [] });
        }
      }

      // 維持快取排序（量能比優先），避免分頁切換前後順序不一致。
      viewStocks = matchedStocks.filter(stock => matchedTickerSet.has(stock.symbol));
      displayCount = viewStocks.length;
    }

    if (displayCount === 0) {
      const emptyEmbed = new EmbedBuilder()
        .setColor(0x3b82f6)
        .setTitle('台股低位爆量突破清單')
        .setDescription('今日市場無符合標的。')
        .addFields(
          { name: '最近更新時間', value: cache.updatedAt ? `<t:${Math.floor(new Date(cache.updatedAt).getTime() / 1000)}:F>` : '未知', inline: false },
          { name: '策略條件', value: cache.strategyDescription || '前30日壓制、今日突破、爆量3倍', inline: false },
          { name: '掃描來源', value: cache.source || '未知', inline: true },
          { name: '掃描母池數量', value: String(cache.sourceStockCount || 0), inline: true },
          { name: '全市場模式', value: cache.fullMarketMode ? '開啟' : '關閉', inline: true }
        );

      await interaction.editReply({ embeds: [emptyEmbed] });
      return;
    }

    await renderBreakoutView(interaction, cache, viewStocks, displayCount, 0, interaction.user.id, 'reply');
  },

  async handleButton(interaction) {
    const parsed = parseButtonId(interaction.customId);
    if (!parsed) return false;

    if (interaction.user.id !== parsed.userId) {
      await interaction.reply({
        content: '這組分頁按鈕只能由原始指令使用者操作。',
        flags: MessageFlags.Ephemeral
      });
      return true;
    }

    const { cache, isScanRunning } = getStockBreakoutCache();
    if (!cache || isScanRunning) {
      await interaction.reply({
        content: '資料正在更新中，請稍後再試。',
        flags: MessageFlags.Ephemeral
      });
      return true;
    }

    const matchedStocks = Array.isArray(cache.matchedStocks) ? cache.matchedStocks : [];
    const displayCount = Math.max(1, Math.min(parsed.displayCount, matchedStocks.length));
    if (displayCount <= 0) {
      await interaction.reply({
        content: '目前沒有可分頁的資料。',
        flags: MessageFlags.Ephemeral
      });
      return true;
    }

    const currentIndex = Math.max(0, Math.min(parsed.index, displayCount - 1));

    if (parsed.action === 'news') {
      const stock = matchedStocks[currentIndex];
      if (!stock) {
        await interaction.reply({
          content: '目前暫無可查詢的新聞資料。',
          flags: MessageFlags.Ephemeral
        });
        return true;
      }

      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      try {
        const tickerCode = getTickerCode(stock.symbol);
        const stockInfo = await resolveStockInfo(`${tickerCode} ${stock.name || ''}`.trim());
        const newsItems = await fetchLatestStockNews(stockInfo, 3);

        if (!Array.isArray(newsItems) || newsItems.length === 0) {
          await interaction.editReply('目前暫無相關即時新聞資訊。');
          return true;
        }

        const summary = await getNewsSummary(`${stock.symbol} ${stock.name || ''}`.trim(), newsItems.map(item => item.title));

        const newsEmbed = new EmbedBuilder()
          .setColor(0x0ea5e9)
          .setTitle(`${stock.symbol} 新聞摘要`)
          .addFields(
            {
              name: '最新新聞',
              value: buildNewsLinks(newsItems),
              inline: false
            },
            {
              name: '市場情緒摘要',
              value: truncateText(summary, 500),
              inline: false
            },
            {
              name: '免責聲明',
              value: '本資訊僅供參考，不構成投資建議。',
              inline: false
            }
          )
          .setTimestamp(new Date());

        await interaction.editReply({ embeds: [newsEmbed] });
      } catch (error) {
        console.error('[twstock_breakout] 新聞摘要查詢失敗:', error);
        await interaction.editReply('目前暫無相關即時新聞資訊。');
      }

      return true;
    }

    const nextIndex = parsed.action === 'next'
      ? (currentIndex + 1) % displayCount
      : (currentIndex - 1 + displayCount) % displayCount;

    await renderBreakoutView(interaction, cache, matchedStocks, displayCount, nextIndex, interaction.user.id, 'update');
    return true;
  },

  async handleSelectMenu(interaction) {
    const parsed = parseSelectId(interaction.customId);
    if (!parsed) return false;

    if (interaction.user.id !== parsed.userId) {
      await interaction.reply({
        content: '這組下拉選單只能由原始指令使用者操作。',
        flags: MessageFlags.Ephemeral
      });
      return true;
    }

    const { cache, isScanRunning } = getStockBreakoutCache();
    if (!cache || isScanRunning) {
      await interaction.reply({
        content: '資料正在更新中，請稍後再試。',
        flags: MessageFlags.Ephemeral
      });
      return true;
    }

    const matchedStocks = Array.isArray(cache.matchedStocks) ? cache.matchedStocks : [];
    const displayCount = Math.max(1, Math.min(parsed.displayCount, matchedStocks.length));
    const selectedValue = Number(interaction.values?.[0] || 0);
    const selectedIndex = Math.max(0, Math.min(selectedValue, displayCount - 1));

    await renderBreakoutView(interaction, cache, matchedStocks, displayCount, selectedIndex, interaction.user.id, 'update');
    return true;
  }
};
