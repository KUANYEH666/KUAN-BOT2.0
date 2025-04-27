const { getChatGPTReply } = require('../../utils/openaiClient');

module.exports = {
  name: 'messageCreate',
  async execute(message) {
    if (message.author.bot) return;
    if (!message.guild || !message.content) return;

    const isReplyToBot =
      message.reference &&
      (await message.channel.messages.fetch(message.reference.messageId))
        ?.author?.id === message.client.user.id;

    const isMentioningBot = message.mentions.has(message.client.user.id);

    if (!isReplyToBot && !isMentioningBot) return;

    const prompt = message.content.replace(`<@${message.client.user.id}>`, '').trim();
    if (!prompt) return;

    try {
      await message.channel.sendTyping(); // 打字中效果
      const reply = await getChatGPTReply(prompt);
      await message.reply(reply.slice(0, 2000)); // Discord 限制最多 2000 字
    } catch (err) {
      console.error('ChatGPT 回應失敗:', err.message);
      await message.reply('⚠️ 無法取得回覆，請稍後再試。');
    }
  }
};
