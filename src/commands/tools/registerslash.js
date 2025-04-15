const { SlashCommandBuilder } = require('@discordjs/builders');
const fs = require('fs');
const path = require('path');
const { REST, Routes } = require('discord.js');
require('dotenv').config();

const adminIds = process.env.ADMINS?.split(',') || [];

module.exports = {
  data: new SlashCommandBuilder()
    .setName('registerslash')
    .setDescription('🛠️ 重新註冊 Slash 指令（限管理員）')
    .addBooleanOption(option =>
      option.setName('global')
        .setDescription('是否註冊為全域指令')
        .setRequired(false)
    )
    .setDefaultMemberPermissions('0')
    .setDMPermission(false),

  async execute(interaction) {
    if (!adminIds.includes(interaction.user.id)) {
      return interaction.reply({
        content: '❌ 你沒有權限使用這個指令。',
        ephemeral: true
      });
    }

    const isGlobal = interaction.options.getBoolean('global') ?? false;
    const clientId = interaction.client.user.id;
    const guildId = interaction.guildId;

    const rest = new REST({ version: '10' }).setToken(process.env.token);

    // 讀取所有指令檔案
    const commands = [];
    const commandFolders = fs.readdirSync(path.join(__dirname, '..'));
    for (const folder of commandFolders) {
      const commandFiles = fs
        .readdirSync(path.join(__dirname, '..', folder))
        .filter(file => file.endsWith('.js'));

      for (const file of commandFiles) {
        const command = require(path.join(__dirname, '..', folder, file));
        if (command.data) {
          commands.push(command.data.toJSON());
        }
      }
    }

    await interaction.deferReply({ ephemeral: true });

    try {
      if (isGlobal) {
        await rest.put(Routes.applicationCommands(clientId), { body: commands });
        await interaction.editReply('🌐 指令已註冊為全域（最多等待 1 小時同步）');
      } else {
        await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: commands });
        await interaction.editReply('🏠 指令已註冊為本伺服器，立即生效');
      }
    } catch (error) {
      console.error('❌ 註冊失敗：', error);
      await interaction.editReply('❌ 註冊失敗，請查看主控台。');
    }
  }
};
