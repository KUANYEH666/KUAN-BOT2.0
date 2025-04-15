const { SlashCommandBuilder } = require('@discordjs/builders');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const KEYWORDS_PATH = path.join(__dirname, '../../JSON/keywords.json');
const adminIds = process.env.ADMINS?.split(',') || [];

function loadKeywords() {
  try {
    if (!fs.existsSync(KEYWORDS_PATH)) return {};
    return JSON.parse(fs.readFileSync(KEYWORDS_PATH, 'utf-8'));
  } catch (error) {
    console.error('讀取 keywords.json 失敗:', error);
    return {};
  }
}

function saveKeywords(keywords) {
  fs.writeFileSync(KEYWORDS_PATH, JSON.stringify(keywords, null, 2), 'utf-8');
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('deletekeyword')
    .setDescription('刪除一個關鍵字（限管理員）')
    .addStringOption(option =>
      option.setName('keyword')
        .setDescription('要刪除的關鍵字')
        .setRequired(true)),

  async execute(interaction) {
    if (!adminIds.includes(interaction.user.id)) {
      return interaction.reply({
        content: '❌ 你沒有權限使用這個指令。',
        ephemeral: true
      });
    }

    await interaction.deferReply({ ephemeral: true });

    const keyword = interaction.options.getString('keyword');
    const keywords = loadKeywords();

    if (!keywords.hasOwnProperty(keyword)) {
      return interaction.editReply(`⚠️ 找不到關鍵字 \`${keyword}\`，無法刪除。`);
    }

    const oldResponse = keywords[keyword];
    delete keywords[keyword];
    saveKeywords(keywords);

    await interaction.editReply(`🗑️ 已刪除關鍵字 \`${keyword}\`\n原本的回應：${oldResponse}`);
  }
};
