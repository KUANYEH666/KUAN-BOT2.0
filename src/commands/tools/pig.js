const { SlashCommandBuilder } = require('@discordjs/builders');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('pooooog')
        .setDescription("查看目前機器人的延遲 並回復POG"),
    async execute(interaction) {
        const msg = await interaction.reply({ content: '正在計算延遲......', fetchReply: true });
        const ping = msg.createdTimestamp - interaction.createdTimestamp;
        await interaction.editReply(`機器人延遲：${ping} ms pog`);
    }
};
