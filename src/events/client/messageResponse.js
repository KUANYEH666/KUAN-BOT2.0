const fs = require('fs');
const path = require('path');

const KEYWORDS_PATH = path.join(__dirname, '../../JSON/keywords.json');

// 強化版：判斷是否略過該訊息
function shouldIgnoreMessage(text) {
  const trimmed = text.trim();
  if (!trimmed) return true;

  const unicodeEmojiRegex = /^(?:\p{Emoji_Presentation}|\p{Extended_Pictographic}|\s)+$/u;
  const customEmojiRegex = /^(<a?:\w+:\d+>\s*)+$/;
  const mentionRegex = /@(?:everyone|here|[!&]?\d+)/;
  const urlRegex = /^https?:\/\/\S+$/i;

  return (
    unicodeEmojiRegex.test(trimmed) || // 純 emoji
    customEmojiRegex.test(trimmed) ||  // 純自訂 emoji
    mentionRegex.test(trimmed) ||      // 含 @ 提及
    urlRegex.test(trimmed)             // 純網址訊息
  );
}


// 內容出現次數統計（key: `${channelId}|${message}`）
const consensusCache = new Map();
const cooldownSet = new Set();

const TRIGGER_WINDOW_MS = 60 * 1000;
const COOLDOWN_MS = 60 * 1000;
const MIN_REPEAT = 3;
const MAX_REPEAT = 5;

function loadKeywords() {
  try {
    if (!fs.existsSync(KEYWORDS_PATH)) return {};
    return JSON.parse(fs.readFileSync(KEYWORDS_PATH, 'utf-8'));
  } catch (error) {
    console.error('❌ 讀取關鍵字失敗:', error);
    return {};
  }
}

module.exports = {
  name: 'messageCreate',
  async execute(message) {
    if (message.author.bot) return;

    const content = message.content.trim();
    if (shouldIgnoreMessage(content)) return;

    const channelId = message.channel.id;
    const now = Date.now();
    const cacheKey = `${channelId}|${content}`;

    // 冷卻中則略過
    if (cooldownSet.has(cacheKey)) return;

    // 清除過期資料
    for (const [key, data] of consensusCache) {
      if (now - data.timestamp > TRIGGER_WINDOW_MS) {
        consensusCache.delete(key);
      }
    }

    // 更新出現次數
    const data = consensusCache.get(cacheKey) || { count: 0, timestamp: now };
    data.count += 1;
    data.timestamp = now;
    consensusCache.set(cacheKey, data);

    // 達成重複條件，觸發一次
    if (data.count >= MIN_REPEAT && data.count <= MAX_REPEAT) {
      await message.channel.send(content);
      consensusCache.delete(cacheKey);
      cooldownSet.add(cacheKey);
      setTimeout(() => cooldownSet.delete(cacheKey), COOLDOWN_MS);
      return;
    }

    // 關鍵字回覆（原本功能）
    const keywords = loadKeywords();
    for (const [keyword, response] of Object.entries(keywords)) {
      if (content.includes(keyword)) {
        await message.channel.send(response);
        break;
      }
    }
  },
};
