const { SlashCommandBuilder } = require('@discordjs/builders');

// 終極密碼遊戲：開始並進行遊戲指令
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

            // 檢查範圍是否合理
            if (min >= max) {
                return interaction.reply('最小數字必須小於最大數字！');
            }

            // 隨機生成一個正確數字
            const secretNumber = Math.floor(Math.random() * (max - min + 1)) + min;

            // 存儲遊戲狀態
            interaction.client.game = {
                min: min,
                max: max,
                secretNumber: secretNumber,
                ongoing: true,
                currentPlayer: interaction.user.id,
                players: [interaction.user.id, opponent.id]
            };

            // 回覆中提及對手
            await interaction.reply(`遊戲開始！<@${interaction.user.id}> 和 <@${opponent.id}>，請猜測一個介於 ${min} 和 ${max} 之間的數字。`);
        } else if (subcommand === 'guess') {
            const guess = interaction.options.getInteger('number');
            const game = interaction.client.game;

            // 確認遊戲是否正在進行
            if (!game || !game.ongoing) {
                return interaction.reply('目前沒有進行中的遊戲，請先使用 /終極密碼 開始一場新遊戲。');
            }

            // 確認是玩家的回合
            if (interaction.user.id !== game.currentPlayer) {
                return interaction.reply('還沒輪到你，請等待對手猜測。');
            }

            // 檢查猜測是否在範圍內
            if (guess < game.min || guess > game.max) {
                return interaction.reply(`請猜測一個介於 ${game.min} 和 ${game.max} 之間的數字。`);
            }

            // 處理猜測結果
            if (guess === game.secretNumber) {
                game.ongoing = false;  // 遊戲結束
                return interaction.reply(`${interaction.user.username} 猜中了！正確的數字是 ${game.secretNumber}。`);
            } else if (guess < game.secretNumber) {
                // 更新最小範圍
                game.min = guess + 1;
                await interaction.reply(`錯誤！數字大於 ${guess}，請猜測一個介於 ${game.min} 和 ${game.max} 之間的數字。`);
            } else {
                // 更新最大範圍
                game.max = guess - 1;
                await interaction.reply(`錯誤！數字小於 ${guess}，請猜測一個介於 ${game.min} 和 ${game.max} 之間的數字。`);
            }

            // 切換到另一位玩家
            game.currentPlayer = game.players.find(player => player !== interaction.user.id);
        }
    }
};
