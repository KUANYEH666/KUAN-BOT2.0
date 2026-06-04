const { InteractionType, MessageFlags } = require('discord.js');

async function safeHandleCommandError(interaction, error) {
    console.error(error);

    // Unknown interaction means token expired or was already handled elsewhere.
    if (error?.code === 10062) return;

    try {
        if (interaction.deferred || interaction.replied) {
            await interaction.followUp({
                content: '發生錯誤，請向管理員回報',
                flags: MessageFlags.Ephemeral
            });
        } else {
            await interaction.reply({
                content: '發生錯誤，請向管理員回報',
                flags: MessageFlags.Ephemeral
            });
        }
    } catch (replyError) {
        if (replyError?.code !== 40060 && replyError?.code !== 10062) {
            console.error(replyError);
        }
    }
}

module.exports = {
    name: 'interactionCreate',
    async execute(interaction, client) {
        if (interaction.isChatInputCommand()) {
            const { commands } = client;
            const { commandName } = interaction;
            const command = commands.get(commandName);
            if (!command) return;

            try {
                await command.execute(interaction, client);
            } catch (error) {
                await safeHandleCommandError(interaction, error);
            }
        } else if (interaction.isButton()) {
            const isBreakoutButton = interaction.customId?.startsWith('twstock_breakout:')
                ;

            if (isBreakoutButton) {
                const breakoutCommand = client.commands.get('twstock_breakout');
                if (breakoutCommand?.handleButton) {
                    try {
                        const handled = await breakoutCommand.handleButton(interaction, client);
                        if (handled) return;
                    } catch (error) {
                        await safeHandleCommandError(interaction, error);
                        return;
                    }
                }
            }

            const { buttons } = client;
            const { customId } = interaction;
            const button = buttons.get(customId);
            if (!button) return new Error('There is no code for this button.');

            try {
                await button.execute(interaction, client);
            } catch (error) {
                console.error(error);
            }
        } else if (interaction.isStringSelectMenu()) {
            if (interaction.customId?.startsWith('twstock_breakout:select:')) {
                const breakoutCommand = client.commands.get('twstock_breakout');
                if (breakoutCommand?.handleSelectMenu) {
                    try {
                        const handled = await breakoutCommand.handleSelectMenu(interaction, client);
                        if (handled) return;
                    } catch (error) {
                        await safeHandleCommandError(interaction, error);
                        return;
                    }
                }
            }

            const { selectMenus } = client;
            const { customId } = interaction;
            const menu = selectMenus.get(customId);
            if (!menu) return new Error('There is no code for this select menu.');

            try {
                await menu.execute(interaction, client);
            } catch (error) {
                console.error(error);
            }
        } else if (interaction.type == InteractionType.ModalSubmit) {
            const { modals } = client;
            const { customId } = interaction;
            const modal = modals.get(customId);
            if (!modal) return new Error('There is no code for this modal.');

            try {
                await modal.execute(interaction, client);
            } catch (error) {
                console.error(error);
            }
        } else if (interaction.isContextMenuCommand()) {
            const { commands } = client;
            const { commandName } = interaction;
            const cotextCommand = commands.get(commandName);
            if (!cotextCommand) return;

            try {
                await cotextCommand.execute(interaction, client);
            } catch (error) {
                console.error(error);
            }
        } else if (interaction.type == InteractionType.ApplicationCommandAutocomplete) {
            const { commands } = client;
            const { commandName } = interaction;
            const command = commands.get(commandName);
            if (!command) return;

            try {
                await command.autocomplete(interaction, client);
            } catch (error) {
                console.error(error);
            }
        }
    },
};