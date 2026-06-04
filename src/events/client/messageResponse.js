const fs = require('fs');
const path = require('path');

const KEYWORDS_PATH = path.join(__dirname, '../../JSON/keywords.json');

// 強化版：判斷是否略過該訊息
function shouldIgnoreMessage(text) {
  const trimmed = text.trim();
  if (!trimmed) return true;

  const unicodeEmojiRegex = /^(?:\p{Emoji_Presentation}|\p{Extended_Pictographic}|\s)+$/u;
  const customEmojiInTextRegex = /<a?:\w+:\d+>/; // ✅ 含有自訂 emoji
  const mentionRegex = /@(?:everyone|here|[!&]?\d+)/;
  const urlRegex = /https?:\/\/\S+/i;

  return (
    unicodeEmojiRegex.test(trimmed) ||     // 純 unicode emoji
    customEmojiInTextRegex.test(trimmed) ||// 含自訂 emoji（不論在哪）
    mentionRegex.test(trimmed) ||          // 含 @ 提及
    urlRegex.test(trimmed)                 // 含網址
  );
}



// 內容出現次數統計（key: `${channelId}|${message}`）
const consensusCache = new Map();
const cooldownSet = new Set();

const TRIGGER_WINDOW_MS = 60 * 1000;
const COOLDOWN_MS = 60 * 1000;
const MIN_REPEAT = 3;
const MAX_REPEAT = 5;

const CALC_PREFIX = '!cal';
const ALLOWED_EXPRESSION = /^[\d+\-*/%().\s]+$/;

function formatNumber(value) {
  if (!Number.isFinite(value)) return null;

  // Keep integer output clean (e.g., 2 instead of 2.0)
  if (Number.isInteger(value)) return String(value);

  // Limit floating noise from JavaScript math
  return Number(value.toFixed(12)).toString();
}

function evaluateExpression(expression) {
  const input = String(expression || '').trim();
  if (!input) {
    throw new Error('EMPTY_EXPRESSION');
  }

  if (input.length > 120) {
    throw new Error('EXPRESSION_TOO_LONG');
  }

  if (!ALLOWED_EXPRESSION.test(input)) {
    throw new Error('INVALID_CHARACTERS');
  }

  let result;
  try {
    result = Function(`"use strict"; return (${input});`)();
  } catch {
    throw new Error('INVALID_EXPRESSION');
  }

  if (!Number.isFinite(result)) {
    throw new Error('NON_FINITE_RESULT');
  }

  return result;
}

async function handleCalculatorCommand(message, content) {
  if (!content.toLowerCase().startsWith(CALC_PREFIX)) return false;

  const expression = content.slice(CALC_PREFIX.length).trim();

  try {
    const result = evaluateExpression(expression);
    const formatted = formatNumber(result);

    if (!formatted) {
      await message.reply('❌ 算式結果無效，請確認輸入內容。');
      return true;
    }

    await message.reply(formatted);
    return true;
  } catch (error) {
    if (error?.message === 'EMPTY_EXPRESSION') {
      await message.reply('❌ 請在 !cal 後面輸入算式，例如：!cal 1+1');
      return true;
    }

    await message.reply('❌ 算式格式錯誤，請確認後再試。');
    return true;
  }
}

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

    const handledByCalculator = await handleCalculatorCommand(message, content);
    if (handledByCalculator) return;

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
