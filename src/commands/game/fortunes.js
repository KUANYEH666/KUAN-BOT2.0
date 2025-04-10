const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');

const fortunesFilePath = path.join(__dirname, '../../JSON/fortunes.json');
const userFortunesFilePath = path.join(__dirname, '../../JSON/userFortunes.json');

// 讀取籤詩資料
const fortunes = JSON.parse(fs.readFileSync(fortunesFilePath, 'utf-8'));

// 初始化用戶籤詩記錄
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

        // 檢查是否已經求過籤
        if (userFortunes[userId] === today) {
            await interaction.reply({
                content: '您今天已經求過運勢了，請明天再來！',
                ephemeral: true
            });
            return;
        }

        // 隨機選擇籤詩
        const selectedFortune = fortunes[Math.floor(Math.random() * fortunes.length)];
        userFortunes[userId] = today; // 記錄今日已求籤
        fs.writeFileSync(userFortunesFilePath, JSON.stringify(userFortunes, null, 2), 'utf-8');

        // 建立 Embed
        const embed = new EmbedBuilder()
            .setTitle("《今日籤詩》")
            .setDescription("求出今日的運勢")
            .setColor(0x708dff)
            .setThumbnail("https://media.discordapp.net/attachments/974975272388526132/1359851627644981289/e6580ddead043e7cbf47c6abcc21bfac.jpg?ex=67f8fc04&is=67f7aa84&hm=76fc65e434a913043964aa249b78e7540fb4a6e2a6b333158c322b5e0858bfa0&=&format=webp")
            .addFields(
                { name: "🎋 **你抽中：**", value: selectedFortune.type, inline: true },
                { name: "📜 **籤詩**", value: selectedFortune.poem, inline: false },
                { name: "💬 **解釋**", value: selectedFortune.explain, inline: false }
            )
            .addFields(
                {
                    name: "📊 **運勢結果**",
                    value: `•  **願望**: ${selectedFortune.result['願望']}\n` +
                           `•  **疾病**: ${selectedFortune.result['疾病']}\n` +
                           `•  **遺失物**: ${selectedFortune.result['遺失物']}\n` +
                           `•  **盼望的人**: ${selectedFortune.result['盼望的人']}\n` +
                           `•  **蓋新居**: ${selectedFortune.result['蓋新居']}\n` +
                           `•  **搬家**: ${selectedFortune.result['搬家']}\n` +
                           `•  **旅行**: ${selectedFortune.result['旅行']}\n` +
                           `•  **結婚**: ${selectedFortune.result['結婚']}\n` +
                           `•  **交往**: ${selectedFortune.result['交往']}`,
                    inline: false
                }
            );

        await interaction.reply({ embeds: [embed] });
    }
};