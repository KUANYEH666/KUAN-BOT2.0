const fs = require('fs');
const path = require('path');

// 路徑請根據你的專案結構調整
const KEYWORDS_PATH = path.join(__dirname, '../../JSON/keywords.json');

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
  async execute(message, client) {
    if (message.author.bot) return;

    const keywords = loadKeywords();
    for (const [keyword, response] of Object.entries(keywords)) {
      if (message.content.includes(keyword)) {
        await message.reply(response);
        break;
      }
    }
  },
};
