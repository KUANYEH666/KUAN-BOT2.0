const { REST } = require('discord.js');
const { Routes } = require('discord.js');
const fs = require('fs');

module.exports = (client) => {
    client.handleCommands = async() => {
        const commandFolder = fs.readdirSync('./src/commands');
        const { commands, commandArray = [] } = client;
        for (const folder of commandFolder) {
            const commandFiles = fs
                .readdirSync(`./src/commands/${folder}`)
                .filter((file) => file.endsWith(".js"));
            for (const file of commandFiles) {
                const command = require(`../../commands/${folder}/${file}`)
                commands.set(command.data.name, command);
                commandArray.push(command.data.toJSON())
                console.log(`[指令] ${command.data.name} ✅`)
            }
        }
    const rest = new REST({version: '9'}).setToken(process.env.token);
    try {
        console.log("[事件] SlashCommands 已開始加載 🤔");
        await rest.put(Routes.applicationCommands(process.env.clientId),{
            body: client.commandArray,
        });
        console.log("[事件] SlashCommands 已完成加載 ✅");
        } catch (error) {
            console.error(error);
        }
    };
};