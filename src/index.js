require('dotenv').config();
const fs = require('fs');
const { Client, GatewayIntentBits, Collection } = require('discord.js');
const { startAutoUpdate, handleManualNext } = require('./utils/activityManager');


const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

client.commands = new Collection();
client.commandArray = [];

// 載入功能模組
const functionFolders = fs.readdirSync('./src/functions');
for (const folder of functionFolders) {
  const functionFiles = fs
    .readdirSync(`./src/functions/${folder}`)
    .filter(file => file.endsWith('.js'));

  for (const file of functionFiles) {
    require(`./functions/${folder}/${file}`)(client);
  }
}

module.exports = client;

client.handleEvents();
client.handleCommands();

// ✅ 當 bot 準備好後啟動自動播放狀態
client.once('ready', () => {
  console.log(`✅ Bot 上線成功：${client.user.tag}`);
  startAutoUpdate(client); // 啟動每 5 分鐘自動更新
});

client.on('messageCreate', message => {
  if (message.author.bot) return;
  handleManualNext(message, client); // !下一首 指令處理
});


client.login(process.env.token);
