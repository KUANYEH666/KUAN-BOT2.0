const { ContextMenuCommandBuilder, ApplicationCommandType } = require('discord.js');
const translate = require('google-translate-api-x');

module.exports = {
  data: new ContextMenuCommandBuilder()
    .setName('翻譯訊息')
    .setType(ApplicationCommandType.Message),

  async execute(interaction) {
    const targetMessage = interaction.targetMessage;
    const text = targetMessage?.content?.trim();

    if (!text || !text.replace(/\s+/g, '')) {
      return interaction.reply({
        content: '⚠️ 該訊息沒有可翻譯的內容。',
        flags: 1 << 6,
      });
    }

    await interaction.deferReply({ flags: 1 << 6 });

    try {
      const zh = await translate(text, { to: 'zh-TW' });
      const en = await translate(text, { to: 'en' });
      const ja = await translate(text, { to: 'ja' });

      await interaction.editReply({
        content:
          `🌐 **翻譯結果：**\n` +
          `🇹🇼 中文：${zh.text}\n` +
          `🇺🇸 英文：${en.text}\n` +
          `🇯🇵 日文：${ja.text}`,
      });
    } catch (error) {
      console.error('翻譯錯誤：', error);
      await interaction.editReply('❌ 翻譯過程中發生錯誤，請稍後再試。');
    }
  }
};
