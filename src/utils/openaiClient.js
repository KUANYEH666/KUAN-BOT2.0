const { OpenAI } = require('openai');
require('dotenv').config();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: process.env.OPENAI_API_BASE, // ✅ 自訂平台必填
});


async function getChatGPTReply(prompt, model = process.env.OPENAI_MODEL || 'gpt-3.5-turbo') {
  const chat = await openai.chat.completions.create({
    model,
    messages: [{ role: 'user', content: prompt }],
    max_tokens: 100,
    temperature: 0.7,
  });

  return chat.choices[0].message.content.trim();
}

function clampText(text, maxChars = 500) {
  const normalized = String(text || '').trim();
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, Math.max(0, maxChars - 1))}…`;
}

async function summarizeStockNewsWithAI({ stockLabel, newsItems, maxChars = 500 } = {}) {
  if (!Array.isArray(newsItems) || newsItems.length === 0) {
    return '目前暫無可摘要的新聞內容。';
  }

  const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';
  const cleanedItems = newsItems.slice(0, 5).map((item, index) => {
    const title = String(item?.title || '').trim();
    const snippet = String(item?.snippet || '').replace(/\s+/g, ' ').trim();
    return `${index + 1}. 標題：${title}\n   摘要：${snippet || '無摘要'}`;
  }).join('\n');

  const prompt = [
    `請分析以下「${stockLabel || '台股'}」最新新聞，並以繁體中文輸出。`,
    '你必須使用以下固定格式：',
    '利多因素：',
    '- ...',
    '利空/風險：',
    '- ...',
    '綜合評論：',
    '- ...',
    '限制：',
    '- 總長度不得超過 500 字。',
    '- 內容要精簡、可讀、避免空話。',
    '',
    '新聞資料：',
    cleanedItems
  ].join('\n');

  const chat = await openai.chat.completions.create({
    model,
    messages: [
      {
        role: 'system',
        content: '你是台股新聞摘要助手，需以繁體中文輸出，並保持中立與精簡。'
      },
      {
        role: 'user',
        content: prompt
      }
    ],
    max_tokens: 380,
    temperature: 0.3,
  });

  return clampText(chat?.choices?.[0]?.message?.content || '', maxChars);
}

async function getNewsSummary(symbol, titles = []) {
  const cleanedTitles = Array.isArray(titles)
    ? titles.map(item => String(item || '').trim()).filter(Boolean).slice(0, 5)
    : [];

  if (cleanedTitles.length === 0) {
    return '目前暫無相關即時新聞資訊。';
  }

  const prompt = [
    `請根據以下 ${symbol || '台股'} 的新聞標題，分析市場情緒。`,
    '請使用繁體中文，並嚴格依照以下格式輸出：',
    '利多點：',
    '- ...',
    '潛在風險：',
    '- ...',
    '整體市場情緒：',
    '- ...',
    '限制：',
    '- 總長度控制在 350 字內。',
    '- 僅根據標題可推論資訊，不要臆測未提供內容。',
    '',
    '新聞標題：',
    ...cleanedTitles.map((title, idx) => `${idx + 1}. ${title}`)
  ].join('\n');

  const chat = await openai.chat.completions.create({
    model: 'gpt-3.5-turbo',
    messages: [
      {
        role: 'system',
        content: '你是台股新聞分析助手，請以繁體中文提供中立、精簡、可讀的重點摘要。'
      },
      {
        role: 'user',
        content: prompt
      }
    ],
    max_tokens: 260,
    temperature: 0.3
  });

  return clampText(chat?.choices?.[0]?.message?.content || '', 500);
}

module.exports = {
  getChatGPTReply,
  summarizeStockNewsWithAI,
  getNewsSummary
};
