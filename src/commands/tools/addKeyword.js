const { SlashCommandBuilder } = require('@discordjs/builders');
const fs = require('fs');
const path = require('path');
require('dotenv').config(); // 請確保在你的 index.js 中也有

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
    .setName('addkeyword')
    .setDescription('新增或更新關鍵字（限管理員）')
    .addStringOption(option =>
      option.setName('keyword')
        .setDescription('要設定的關鍵字')
        .setRequired(true))
    .addStringOption(option =>
      option.setName('response')
        .setDescription('文字回應（或留空並上傳圖片）')
        .setRequired(false))
    .addAttachmentOption(option =>
      option.setName('image')
        .setDescription('上傳一張圖片作為回應')
        .setRequired(false)),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const keyword = interaction.options.getString('keyword');
    const responseText = interaction.options.getString('response');
    const attachment = interaction.options.getAttachment('image');

    if (!responseText && !attachment) {
      return interaction.editReply('⚠️ 請提供文字回應或圖片檔案其中之一。');
    }

    const keywords = loadKeywords();
    const response = attachment ? attachment.url : responseText;

    const isOverwrite = keywords.hasOwnProperty(keyword);
    const oldResponse = keywords[keyword];
    keywords[keyword] = response;
    saveKeywords(keywords);

    const replyMsg = isOverwrite
      ? `🔄 關鍵字 \`${keyword}\` 已更新。\n原回應: ${oldResponse}\n新回應: ${response}`
      : `✅ 已新增關鍵字 \`${keyword}\`\n回應設定: ${response}`;

    await interaction.editReply(replyMsg);
  }
};
