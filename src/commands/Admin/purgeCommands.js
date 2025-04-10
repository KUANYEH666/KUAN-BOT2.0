const { SlashCommandBuilder } = require('discord.js');
const { REST, Routes } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('purge-commands')
        .setDescription('⚠️ 刪除機器人所有指令（開發用）')
        .addStringOption(option =>
            option.setName('scope')
                .setDescription('清除範圍')
                .addChoices(
                    { name: '所有指令（全域+伺服器）', value: 'all' },
                    { name: '只刪全域指令', value: 'global' },
                    { name: '只刪當前伺服器指令', value: 'guild' }
                )
                .setRequired(true)
        )
        .setDefaultMemberPermissions(0), // 僅管理員可用
    async execute(interaction) {
        if (!interaction.member.permissions.has('ADMINISTRATOR')) {
            return interaction.reply({ content: '❌ 此指令僅限管理員使用！', ephemeral: true });
        }

        const rest = new REST({ version: '10' }).setToken(process.env.token);
        const scope = interaction.options.getString('scope');

        await interaction.deferReply({ ephemeral: true });

        try {
            // 刪除全域指令
            if (scope === 'all' || scope === 'global') {
                const globalCommands = await rest.get(Routes.applicationCommands(process.env.clientId));
                await Promise.all(globalCommands.map(cmd =>
                    rest.delete(Routes.applicationCommand(process.env.clientId, cmd.id))
                ));
            }

            // 刪除當前伺服器指令
            if (scope === 'all' || scope === 'guild') {
                const guildCommands = await rest.get(
                    Routes.applicationGuildCommands(process.env.clientId, interaction.guildId)
                );
                await Promise.all(guildCommands.map(cmd =>
                    rest.delete(Routes.applicationGuildCommand(process.env.clientId, interaction.guildId, cmd.id))
                ));
            }

            await interaction.editReply({
                content: `✅ 已成功刪除 ${scope === 'all' ? '所有指令' : scope === 'global' ? '全域指令' : '當前伺服器指令'}！\n` +
                        '⚠️ 指令列表可能需要幾分鐘才會在 Discord 更新。'
            });
        } catch (error) {
            console.error(error);
            await interaction.editReply({
                content: '❌ 刪除指令時發生錯誤：\n```' + error.message + '```'
            });
        }
    }
};