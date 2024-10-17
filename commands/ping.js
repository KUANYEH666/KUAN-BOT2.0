const { SlashCommandBuilder } = require('@discordjs/builders');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('ping')
        .setDescription("查看目前機器人的延遲"),
    async execute(interaction) {
        // 回覆等待消息
        const msg = await interaction.reply({ content: '正在計算延遲......', fetchReply: true });
        
        // 計算延遲
        const ping = msg.createdTimestamp - interaction.createdTimestamp;
        
        // 編輯回覆以顯示延遲時間
        await interaction.editReply(`機器人延遲：${ping} ms`);
    }
};
