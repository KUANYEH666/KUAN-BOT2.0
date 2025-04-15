const { SlashCommandBuilder } = require('@discordjs/builders');
const { REST, Routes } = require('discord.js');
require('dotenv').config();

const adminIds = process.env.ADMINS?.split(',') || [];

module.exports = {
  data: new SlashCommandBuilder()
    .setName('clearslash')
    .setDescription('🧹 清除目前伺服器所有 Slash 指令（限管理員）')
    .setDefaultMemberPermissions('0')
    .setDMPermission(false),

  async execute(interaction) {
    if (!adminIds.includes(interaction.user.id)) {
      return interaction.reply({
        content: '❌ 你沒有權限使用這個指令。',
        ephemeral: true
      });
    }

    const guildId = interaction.guildId;
    const clientId = interaction.client.user.id;

    const rest = new REST({ version: '10' }).setToken(process.env.token);

    await interaction.deferReply({ ephemeral: true });

    try {
      await rest.put(Routes.applicationGuildCommands(clientId, guildId), {
        body: []
      });

      await interaction.editReply(`✅ 此伺服器的 Slash 指令已清除。`);
    } catch (err) {
      console.error('❌ 清除失敗:', err);
      await interaction.editReply('❌ 清除失敗，請查看控制台日誌。');
    }
  }
};
