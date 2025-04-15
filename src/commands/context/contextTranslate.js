const { ContextMenuCommandBuilder, ApplicationCommandType } = require('discord.js');
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

module.exports = {
  data: new ContextMenuCommandBuilder()
    .setName('Translate Message') // 必須英文命名
    .setType(ApplicationCommandType.Message),

  async execute(interaction) {
    const targetMessage = interaction.targetMessage;
    const content = targetMessage.content;

    if (!content || content.length === 0) {
      return interaction.reply({
        content: '⚠️ 此訊息沒有可翻譯的內容。',
        ephemeral: true
      });
    }

    await interaction.deferReply({ ephemeral: true });

    const translated = await translateAll(content);

    if (!translated) {
      return interaction.editReply('❌ 翻譯失敗，請稍後再試。');
    }

    await interaction.editReply({
      content: `🌐 **翻譯結果：**
:man_with_chinese_cap::skin-tone-5:  中文：${translated.zh}
🇺🇸 英文：${translated.en}
🇯🇵 日文：${translated.ja}`
    });
  }
};

// ⬇️ 使用 LibreTranslate API 翻譯多語言
async function translateAll(text) {
    const baseURL = 'https://translate.flossboxin.org.in/translate';
  const targets = { zh: 'zh', en: 'en', ja: 'ja' };
  const result = {};

  try {
    for (const [langKey, langCode] of Object.entries(targets)) {
      const res = await fetch(baseURL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          q: text,
          source: 'auto',
          target: langCode,
          format: 'text'
        })
      });

      const data = await res.json();
      result[langKey] = data.translatedText;
    }

    return result;
  } catch (err) {
    console.error('LibreTranslate 錯誤：', err);
    return null;
  }
}
