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

module.exports = {
  data: new SlashCommandBuilder()
    .setName('listkeywords')
    .setDescription('查看所有已設定的關鍵字（支援分頁、搜尋、過濾）')
    .addIntegerOption(option =>
      option.setName('page')
        .setDescription('第幾頁（每頁 10 筆）')
        .setRequired(false))
    .addStringOption(option =>
      option.setName('search')
        .setDescription('搜尋關鍵字（模糊比對）')
        .setRequired(false))
    .addStringOption(option =>
      option.setName('type')
        .setDescription('過濾回應類型')
        .addChoices(
          { name: '全部', value: 'all' },
          { name: '文字', value: 'text' },
          { name: '圖片', value: 'image' }
        )
        .setRequired(false)
    ),

  async execute(interaction) {
    if (!adminIds.includes(interaction.user.id)) {
      return interaction.reply({
        content: '❌ 你沒有權限使用這個指令。',
        ephemeral: true
      });
    }

    await interaction.deferReply({ ephemeral: true });

    const page = interaction.options.getInteger('page') || 1;
    const search = interaction.options.getString('search')?.toLowerCase();
    const filterType = interaction.options.getString('type') || 'all';

    const allKeywords = loadKeywords();
    let entries = Object.entries(allKeywords); // [ [keyword, response], ... ]

    // 過濾：搜尋關鍵字
    if (search) {
      entries = entries.filter(([k]) => k.toLowerCase().includes(search));
    }

    // 過濾：依回應類型
    if (filterType === 'text') {
      entries = entries.filter(([, v]) => !/^https?:\/\//.test(v));
    } else if (filterType === 'image') {
      entries = entries.filter(([, v]) => /^https?:\/\//.test(v));
    }

    // 分頁處理
    const perPage = 10;
    const totalPages = Math.ceil(entries.length / perPage);
    const currentPage = Math.max(1, Math.min(page, totalPages || 1));
    const start = (currentPage - 1) * perPage;
    const paginated = entries.slice(start, start + perPage);

    if (entries.length === 0) {
      return interaction.editReply('📂 沒有符合條件的關鍵字。');
    }

    const lines = paginated.map(([k, v]) => {
      const display = /^https?:\/\//.test(v) ? '[圖片]' : v;
      return `🔹 \`${k}\`: ${display}`;
    }).join('\n');

    await interaction.editReply(
      `📋 符合條件的關鍵字（第 ${currentPage} / ${totalPages || 1} 頁）：\n${lines}`
    );
  }
};
