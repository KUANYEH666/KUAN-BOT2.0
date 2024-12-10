const { SlashCommandBuilder } = require('@discordjs/builders');
const fs = require('fs');
const path = require('path');

const fortunesFilePath = path.join(__dirname, '../../JSON/fortunes.json');
const userFortunesFilePath = path.join(__dirname, '../../JSON/userFortunes.json');

const fortunes = JSON.parse(fs.readFileSync(fortunesFilePath, 'utf-8'));

let userFortunes = {};

if (fs.existsSync(userFortunesFilePath)) {
    const data = fs.readFileSync(userFortunesFilePath, 'utf-8');
    userFortunes = JSON.parse(data);
} else {
    fs.writeFileSync(userFortunesFilePath, JSON.stringify({}), 'utf-8');
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('fortune')
        .setDescription('給你今日的運勢！'),
    async execute(interaction) {
        const userId = interaction.user.id;
        const today = new Date().toDateString();

        if (userFortunes[userId] === today) {
            await interaction.reply('您今天已經求過運勢了，請明天再來！');
            return;
        }

        const selectedFortune = fortunes[Math.floor(Math.random() * fortunes.length)];

        userFortunes[userId] = today;

        fs.writeFileSync(userFortunesFilePath, JSON.stringify(userFortunes, null, 2), 'utf-8');

        const result = selectedFortune.result;
        const fortuneMessage = 
            `🎋 **你抽中：**\n` +
            `🔮 **類型**: ${selectedFortune['type']}\n\n` +
            `📜 **簽詩**:\n${selectedFortune['poem']}\n\n` +
            `💬 **解釋**:\n${selectedFortune['explain']}\n\n` +
            `📊 **結果**:\n` +
            `• 願望: ${result['願望']}\n` +
            `• 疾病: ${result['疾病']}\n` +
            `• 遺失物: ${result['遺失物']}\n` +
            `• 盼望的人: ${result['盼望的人']}\n` +
            `• 蓋新居: ${result['蓋新居']}\n` +
            `• 搬家: ${result['搬家']}\n` +
            `• 旅行: ${result['旅行']}\n` +
            `• 結婚: ${result['結婚']}\n` +
            `• 交往: ${result['交往']}`;

        await interaction.reply(fortuneMessage);
    }
};
