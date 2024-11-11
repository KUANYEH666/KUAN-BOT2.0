const { SlashCommandBuilder } = require('@discordjs/builders');
const fs = require('fs');
const path = require('path');

// 確保 `fortunes.json` 和 `userFortunes.json` 的路徑正確
const fortunesFilePath = path.join(__dirname, 'JSON', 'fortunes.json'); // 引用 commands/JSON 資料夾中的 fortunes.json
const userFortunesFilePath = path.join(__dirname, 'userFortunes.json');

// 加載 `fortunes.json` 文件
const fortunes = JSON.parse(fs.readFileSync(fortunesFilePath, 'utf-8'));

// 加載 `userFortunes.json` 文件
let userFortunes = {};

// 如果 `userFortunes.json` 存在，讀取它的內容
if (fs.existsSync(userFortunesFilePath)) {
    const data = fs.readFileSync(userFortunesFilePath, 'utf-8');
    userFortunes = JSON.parse(data);
} else {
    // 如果文件不存在，創建一個空對象並寫入一個空文件
    fs.writeFileSync(userFortunesFilePath, JSON.stringify({}), 'utf-8');
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('fortune')
        .setDescription('給你今日的運勢！'),
    async execute(interaction) {
        const userId = interaction.user.id;
        const today = new Date().toDateString();  // 取得當天的日期作為標識

        // 檢查用戶今天是否已經請求過運勢
        if (userFortunes[userId] === today) {
            await interaction.reply('您今天已經求過運勢了，請明天再來！');
            return;
        }

        // 隨機選取一個運勢
        const selectedFortune = fortunes[Math.floor(Math.random() * fortunes.length)];

        // 記錄用戶今天的請求
        userFortunes[userId] = today;

        // 將更新的記錄寫入 `userFortunes.json`
        fs.writeFileSync(userFortunesFilePath, JSON.stringify(userFortunes, null, 2), 'utf-8');

        // 格式化詳細結果
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

        // 回覆運勢
        await interaction.reply(fortuneMessage);
    }
};
