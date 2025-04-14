require('dotenv').config();
const fs = require('fs');
const { Client, ActivityType, GatewayIntentBits, Collection } = require('discord.js');
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

client.commands = new Collection();
client.commandArray = [];

const functionFolders = fs.readdirSync(`./src/functions`);
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

client.once('ready', () => {
  client.user.setActivity('空の箱', { type: ActivityType.Listening });
});

client.login(process.env.token);
