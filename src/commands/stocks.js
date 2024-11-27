const { SlashCommandBuilder } = require('@discordjs/builders');
const axios = require('axios');
const { ActionRowBuilder, ButtonBuilder } = require('discord.js');
const QuickChart = require('quickchart-js');
const { apiToken } = require('../config.json');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('finance')
        .setDescription('查詢股票或基金的詳細資訊並生成K線圖')
        .addStringOption(option =>
            option.setName('symbol')
                .setDescription('金融商品代碼，例如: 2330、00687B、VFINX')
                .setRequired(true)
        ),
    async execute(interaction) {
        await interaction.deferReply(); // 延遲回應，確保有足夠時間生成圖表

        const symbol = interaction.options.getString('symbol');

        try {
            const isFund = /^[A-Za-z]/.test(symbol);  // 判斷是否為基金代碼

            if (isFund) {
                // 爬取基金資訊
                const url = `https://www.moneydj.com/funddj/ya/yp010000.djhtm?a=${symbol}`;
                const response = await axios.get(url);
                const fundName = response.data.match(/基金名稱.*?<span.*?>(.*?)<\/span>/)[1];
                const nav = response.data.match(/基金淨值.*?<span.*?>(.*?)<\/span>/)[1];
                const change = response.data.match(/日漲跌.*?<span.*?>(.*?)<\/span>/)[1];
                const date = response.data.match(/資料日期.*?<span.*?>(.*?)<\/span>/)[1];

                const message = `📈 ${symbol} - ${fundName}\n淨值：${nav}\n漲跌幅：${change}\n更新日期：${date}`;
                await interaction.editReply(message);
            } else {
                // 使用 FinMind API 獲取台灣股票數據
                const stockUrl = `https://api.finmindtrade.com/api/v4/data?dataset=TaiwanStockPrice&data_id=${symbol}&start_date=2023-01-01&token=${apiToken}`;
                const response = await axios.get(stockUrl);
                const stockData = response.data.data;

                if (stockData.length === 0) {
                    return interaction.editReply(`無法找到代碼 ${symbol} 的股票數據`);
                }

                const todayData = stockData[stockData.length - 1];
                const message = `📈 ${symbol}\n開盤：${todayData.open} 收盤：${todayData.close}\n最高：${todayData.max} 最低：${todayData.min}\n成交量：${todayData.Trading_Volume}`;

                // 生成 K 線圖
                const chart = new QuickChart();
                chart.setConfig({
                    type: 'candlestick',
                    data: {
                        labels: stockData.map(d => d.date),
                        datasets: [
                            {
                                label: `${symbol} K 線圖`,
                                data: stockData.map(d => ({ o: d.open, h: d.max, l: d.min, c: d.close }))
                            }
                        ]
                    }
                });

                chart.setVersion(3);  // 確保使用 Chart.js v3

                const row = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId('kd_line')
                        .setLabel('顯示KD線')
                        .setStyle(1),  // 使用數字 1 代表 Primary
                    new ButtonBuilder()
                        .setCustomId('ma_line')
                        .setLabel('顯示月線')
                        .setStyle(2),  // 使用數字 2 代表 Secondary
                    new ButtonBuilder()
                        .setCustomId('breakthrough')
                        .setLabel('突破月均線')
                        .setStyle(3)  // 使用數字 3 代表 Success
                );

                await interaction.editReply({
                    content: message,
                    files: [{ attachment: chart.getUrl(), name: 'k_chart.png' }],
                    components: [row]
                });
            }
        } catch (error) {
            console.error(error);
            await interaction.editReply('發生錯誤，無法獲取數據。');
        }
    }
};
