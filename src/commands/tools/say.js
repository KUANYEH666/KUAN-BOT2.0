const { SlashCommandBuilder } = require('@discordjs/builders');
const fs = require('fs');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('say')
        .setDescription('傳送訊息 不會讓別人知道:bird_04:')
        .addStringOption(option => 
            option.setName('message')
                .setDescription('輸入你想說的訊息')
                .setRequired(true)),
    async execute(interaction) {
        // 獲取輸入訊息
        const messageContent = interaction.options.getString('message');

        // 刪除使用者執行指令的訊息
        if (interaction.channel) {
            await interaction.deferReply({ ephemeral: true }); // 隱藏操作回應
            await interaction.deleteReply(); // 刪除指令訊息
        }

        // 傳送輸入訊息到頻道
        await interaction.channel.send(messageContent);

        // 將訊息記錄到後台 (檔案儲存)
        const logMessage = `[${new Date().toISOString()}] ${interaction.user.tag}: ${messageContent}\n`;
        fs.appendFile('message-log.txt', logMessage, (err) => {
            if (err) {
                console.error('無法記錄訊息到檔案:', err);
            }
        });
    },
};
