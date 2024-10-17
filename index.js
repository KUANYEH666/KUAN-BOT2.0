const fs = require('fs');
const { Client, GatewayIntentBits, Collection, REST, Routes } = require('discord.js');
const { clientId, guildId, token } = require('./config.json');

// 創建機器人 client
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] });

// 創建一個 commands 集合來存放所有斜線指令
client.commands = new Collection();
const commandFiles = fs.readdirSync('./commands').filter(file => file.endsWith('.js'));

// 創建一個陣列來儲存所有指令資料
const commands = [];

// 從 commands 資料夾讀取每個指令，並推送到 commands 集合和陣列
for (const file of commandFiles) {
    const command = require(`./commands/${file}`);
    client.commands.set(command.data.name, command);
    commands.push(command.data.toJSON());
}

// 自動註冊和刪除伺服器專屬斜線指令
const rest = new REST({ version: '10' }).setToken(token);

(async () => {
    try {
        console.log('開始刪除所有斜線指令。');

        // 刪除伺服器上的所有斜線指令
        const existingCommands = await rest.get(
            Routes.applicationGuildCommands(clientId, guildId)
        );

        for (const command of existingCommands) {
            await rest.delete(
                Routes.applicationGuildCommand(clientId, guildId, command.id)
            );
        }

        console.log('成功所有指令。');

        // 註冊當前的斜線指令
        console.log('開始註冊斜線指令。');

        await rest.put(
            Routes.applicationGuildCommands(clientId, guildId),
            { body: commands }
        );

        console.log('成功註冊斜線指令。');
    } catch (error) {
        console.error('註冊伺服器指令時出錯：', error);
    }
})();

// 當機器人成功登入時觸發
client.once('ready', () => {
    console.log(`已登入 ${client.user.tag}!`);
});

// 處理斜線指令
client.on('interactionCreate', async interaction => {
    if (!interaction.isCommand()) return;

    const command = client.commands.get(interaction.commandName);

    if (!command) return;

    try {
        await command.execute(interaction);
    } catch (error) {
        console.error('執行指令時出錯：', error);
        await interaction.reply({ content: '執行指令時發生錯誤！', ephemeral: true });
    }
});

client.login(token);
