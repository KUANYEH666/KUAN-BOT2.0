require('dotenv').config();
const fs = require('fs');
const { Client, ActivityType, GatewayIntentBits, Collection } = require('discord.js');

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.MessageContent] });
client.commands = new Collection();

client.commandArray = [];
client.commands.set([]);

const functionFolders = fs.readdirSync(`./src/functions`);
for(const folder of functionFolders) {
    const functionFolders = fs
        .readdirSync(`./src/functions/${folder}`)
        .filter((file) => file.endsWith(".js"))
    for (const file of functionFolders)
        require(`./functions/${folder}/${file}`)(client);
}

module.exports = client;

client.handleEvents();
client.handleCommands();

client.login(process.env.token).then(() => {
    client.user.setActivity(`${process.env.bot_status}`, {type: ActivityType.Watching});
});;