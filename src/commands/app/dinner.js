const { SlashCommandBuilder } = require('@discordjs/builders');
const fs = require('fs');
const path = require('path');
const dinnerFilePath = path.join(__dirname, '../../JSON/dinner_options.json');
const dinners = JSON.parse(fs.readFileSync(dinnerFilePath, 'utf-8')).dinner_options;

module.exports = {
    data: new SlashCommandBuilder()
        .setName('dinner')
        .setDescription('吃啥！'),
    async execute(interaction) {
        // 隨機選擇一個晚餐
        const selectedDinner = dinners[Math.floor(Math.random() * dinners.length)];
        await interaction.reply(selectedDinner);
    }
};
