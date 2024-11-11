const { REST } = require('discord.js');
const { Routes } = require('discord.js');
const fs = require('fs');

module.exports = async (client) => {
    const commandFolders = fs.readdirSync('./commands');
    client.commandArray = [];

    for (const folder of commandFolders) {
        const commandFiles = fs.readdirSync(`./commands/${folder}`).filter(file => file.endsWith('.js'));
        for (const file of commandFiles) {
            const command = require(`../../commands/${folder}/${file}`);
            client.commands.set(command.data.name, command);
            client.commandArray.push(command.data.toJSON());
        }
    }

    const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);
    try {
        console.log('開始註冊斜線指令...');
        await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), {
            body: client.commandArray,
        });
        console.log('成功註冊斜線指令。');
    } catch (error) {
        console.error('註冊斜線指令時發生錯誤：', error);
    }
};