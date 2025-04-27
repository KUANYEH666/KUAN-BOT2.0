const {
    ContextMenuCommandBuilder,
    ApplicationCommandType,
    EmbedBuilder,
  } = require('discord.js');
  
  module.exports = {
    data: new ContextMenuCommandBuilder()
      .setName('偷emoji')
      .setType(ApplicationCommandType.Message),
  
    async execute(interaction) {
      // 只能在伺服器內用
      if (!interaction.inGuild()) {
        return interaction.reply({
          content: '❌ 此指令只能在伺服器中使用。',
          flags: 1 << 6, // EPHEMERAL
        });
      }
  
      // 取得被回覆的訊息
      const message = await interaction.channel.messages.fetch(interaction.targetId);
      const emojiRegex = /<a?:(\w+):(\d+)>/g;
      const matches = [...message.content.matchAll(emojiRegex)];
  
      if (!matches.length && !message.attachments.size) {
        return interaction.reply({
          content: '❌ 此訊息中沒有可偷的自訂表情符號或圖片。',
          flags: 1 << 6,
        });
      }
  
      const results = [];
  
      // 處理自訂 emoji
      for (const [, baseName, id] of matches) {
        const url = `https://cdn.discordapp.com/emojis/${id}.${matches[0][0].startsWith('<a:') ? 'gif' : 'png'}?quality=lossless`;
        let name = baseName;
        let suffix = 1;
  
        // 防重名
        while (interaction.guild.emojis.cache.some(e => e.name === name)) {
          name = `${baseName}_${suffix++}`;
        }
  
        try {
          const emoji = await interaction.guild.emojis.create({ attachment: url, name });
          // 直接顯示該 emoji
          results.push(`✅ 已新增：${emoji.toString()}`);
        } catch (err) {
          results.push(`⚠️ 新增失敗：${name} (${err.message})`);
        }
      }
  
      // 處理圖片附件
      for (const attachment of message.attachments.values()) {
        const url = attachment.url;
        const baseName = attachment.name.split('.')[0];
        let name = baseName;
        let suffix = 1;
  
        while (interaction.guild.emojis.cache.some(e => e.name === name)) {
          name = `${baseName}_${suffix++}`;
        }
  
        try {
          const emoji = await interaction.guild.emojis.create({ attachment: url, name });
          results.push(`✅ 已新增：${emoji.toString()}`);
        } catch (err) {
          results.push(`⚠️ 新增失敗：${name} (${err.message})`);
        }
      }
  
      const embed = new EmbedBuilder()
        .setTitle('🛠️ 表情符號新增結果')
        .setDescription(results.join('\n'))
        .setColor(0x00AE86);
  
      await interaction.reply({
        embeds: [embed],
        flags: 1 << 6, // EPHEMERAL
      });
    },
  };
  