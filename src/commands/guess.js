const { SlashCommandBuilder } = require('@discordjs/builders');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('ultimatenumber')
        .setNameLocalizations({
            "zh-TW": "終極密碼",
        })
        .setDescription('開始一場終極密碼遊戲並進行猜測')
        .setDescriptionLocalizations({
            "zh-TW": "開始一場終極密碼遊戲並進行猜測",
        })
        .addSubcommand(subcommand => 
            subcommand
                .setName('start')
                .setNameLocalizations({
                    "zh-TW": "開始",
                })
                .setDescription('開始一場終極密碼遊戲')
                .setDescriptionLocalizations({
                    "zh-TW": "開始一場終極密碼遊戲",
                })
                .addIntegerOption(option => 
                    option.setName('min')
                    .setDescription('最小數字')
                    .setDescriptionLocalizations({
                        "zh-TW": "最小數字",
                    })
                    .setRequired(true)
                )
                .addIntegerOption(option => 
                    option.setName('max')
                    .setDescription('最大數字')
                    .setDescriptionLocalizations({
                        "zh-TW": "最大數字",
                    })
                    .setRequired(true)
                )
                .addUserOption(option => 
                    option.setName('opponent')
                    .setDescription('選擇您的對手')
                    .setDescriptionLocalizations({
                        "zh-TW": "選擇您的對手",
                    })
                    .setRequired(true)
                )
        )
        .addSubcommand(subcommand => 
            subcommand
                .setName('guess')
                .setNameLocalizations({
                    "zh-TW": "猜測",
                })
                .setDescription('猜測終極密碼的數字')
                .setDescriptionLocalizations({
                    "zh-TW": "猜測終極密碼的數字",
                })
                .addIntegerOption(option => 
                    option.setName('number')
                    .setDescription('您猜測的數字')
                    .setDescriptionLocalizations({
                        "zh-TW": "您猜測的數字",
                    })
                    .setRequired(true)
                )
        ),
    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();

        if (subcommand === 'start') {
            const min = interaction.options.getInteger('min');
            const max = interaction.options.getInteger('max');
            const opponent = interaction.options.getUser('opponent');

            if (min >= max) {
                return interaction.reply('最小數字必須小於最大數字！');
            }

            const secretNumber = Math.floor(Math.random() * (max - min + 1)) + min;

            interaction.client.game = {
                min: min,
                max: max,
                secretNumber: secretNumber,
                ongoing: true,
                currentPlayer: interaction.user.id,
                players: [interaction.user.id, opponent.id]
            };

            await interaction.reply(`遊戲開始！<@${interaction.user.id}> 和 <@${opponent.id}>，請猜測一個介於 ${min} 和 ${max} 之間的數字。`);
        } else if (subcommand === 'guess') {
            const guess = interaction.options.getInteger('number');
            const game = interaction.client.game;

            if (!game || !game.ongoing) {
                return interaction.reply('目前沒有進行中的遊戲，請先使用 /終極密碼 開始一場新遊戲。');
            }

            if (interaction.user.id !== game.currentPlayer) {
                return interaction.reply('還沒輪到你，請等待對手猜測。');
            }

            if (guess < game.min || guess > game.max) {
                return interaction.reply(`請猜測一個介於 ${game.min} 和 ${game.max} 之間的數字。`);
            }

            if (guess === game.secretNumber) {
                game.ongoing = false;
                return interaction.reply(`${interaction.user.username} 猜中了！正確的數字是 ${game.secretNumber}。`);
            } else if (guess < game.secretNumber) {
                game.min = guess + 1;
                await interaction.reply(`錯誤！數字大於 ${guess}，請猜測一個介於 ${game.min} 和 ${game.max} 之間的數字。`);
            } else {
                game.max = guess - 1;
                await interaction.reply(`錯誤！數字小於 ${guess}，請猜測一個介於 ${game.min} 和 ${game.max} 之間的數字。`);
            }

            game.currentPlayer = game.players.find(player => player !== interaction.user.id);
        }
    }
};
