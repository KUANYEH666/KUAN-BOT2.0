const fs = require('fs');
const { Client, GatewayIntentBits, Collection } = require('discord.js');
const { clientId, guildId, token } = require('./config.json');

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.MessageContent] });
client.commands = new Collection();

const functionFolders = fs.readdirSync('./src/functions');
for (const folder of functionFolders) {
    const functionFiles = fs.readdirSync(`./src/functions/${folder}`).filter(file => file.endsWith('.js'));
    for (const file of functionFiles) {
        require(`./src/functions/${folder}/${file}`)(client);
    }
}

client.login(token);