const { SlashCommandBuilder } = require('@discordjs/builders');
const yahooFinance = require('yahoo-finance2').default;

module.exports = {
    data: new SlashCommandBuilder()
        .setName('stock')
        .setDescription('查詢股票資訊')
        .addStringOption(option =>
            option.setName('symbol')
                .setDescription('股票代號，例如: 2330.TW')
                .setRequired(true)
        ),
    async execute(interaction) {
        const symbol = interaction.options.getString('symbol');

        try {
            // 獲取股票數據
            const stockData = await yahooFinance.quote(symbol);
            const { regularMarketPrice, regularMarketChange, regularMarketChangePercent, regularMarketOpen, regularMarketPreviousClose, regularMarketDayHigh, regularMarketDayLow, regularMarketVolume } = stockData;
            const updatedDate = new Date().toLocaleDateString();

            // 構建股票訊息
            const stockMessage = `📈 ${symbol} - ${stockData.shortName}\n` +
                `變動：TWD ${regularMarketChange.toFixed(2)} (${regularMarketChangePercent.toFixed(2)}%)\n` +
                `開盤：${regularMarketOpen} | 收盤：${regularMarketPreviousClose}\n` +
                `最高價：${regularMarketDayHigh} | 最低價：${regularMarketDayLow}\n` +
                `成交量：${regularMarketVolume.toLocaleString()}\n` +
                `更新日期：${updatedDate}`;

            // 回覆股票訊息
            await interaction.reply({ content: stockMessage });
        } catch (error) {
            console.error(error);
            await interaction.reply('獲取股票數據時發生錯誤，請檢查股票代號是否正確。');
        }
    }
};
