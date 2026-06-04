const { OpenAI } = require('openai');
const { searchTraTrains } = require('../../utils/twTraData');
const { resolveTrainQueryDate } = require('../../utils/trainSchedule/traDateResolver');
const { buildTrainEmbed } = require('../../utils/trainSchedule/traTrainFormatter');
const { normalizeTraStation } = require('../../utils/trainSchedule/traStationNormalizer');
const stationMap = require('../../JSON/tra_station_map.json');
const {
  rememberUserMessage,
  rememberAssistantReply,
  buildMemoryPrompt,
  isHistoryExportRequest
} = require('../../utils/conversationMemory');

require('dotenv').config();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: process.env.OPENAI_API_BASE,
});

const HISTORY_REFUSAL =
  '我不能列出完整歷史紀錄，但可以根據目前保留的短期上下文，整理與這次問題相關的重點。';

const CONVERSATION_MEMORY_RULES = `# 對話記憶規則
- 你只能使用目前提供的短期上下文與最近問題記憶來理解當前問題。
- 只能簡短引用或摘要與目前問題直接相關的內容。
- 不要主動暴露記憶內容。
- 使用繁體中文回覆。`;

const STATION_ALIASES = {
  北車: '臺北',
  台北: '臺北',
  台北車站: '臺北',
  臺北車站: '臺北',
  台中: '臺中',
  台中車站: '臺中',
  臺中車站: '臺中',
  台南: '臺南',
  台南車站: '臺南',
  臺南車站: '臺南',
  台東: '臺東',
  台東車站: '臺東',
  臺東車站: '臺東'
};

const STATION_CANDIDATES = [...new Set([
  ...Object.keys(STATION_ALIASES),
  ...Object.keys(stationMap)
])].sort((a, b) => b.length - a.length);

// ============ 台鐵參數抽取 Prompt ============
const TRAIN_AGENT_PROMPT = `# 台鐵查詢參數抽取器

你只負責從使用者訊息抽取台鐵查詢參數，不負責產生最終回答。

請只抽取：
- origin：出發站
- destination：抵達站
- rawDateText：使用者原文中的日期片段，例如「今天」「明天」「6/4」「2026-06-04」
- timeRange：morning / afternoon / evening / night
- time：HH:mm

限制：
- 不要自行推測日期。
- 使用者只說「早上 / 下午 / 晚上」時，只設定 timeRange，不要填 date。
- 不要輸出火車表格、票價、誤點或任何最終回答。`;

/**
 * 檢查訊息是否需要台鐵查詢
 */
function shouldTriggerTrainAgent(message) {
  const content = message.content
    .replace(/<@!?\d+>/g, '')
    .toLowerCase()
    .trim();

  const trainKeywords = [
    '火車',
    '台鐵',
    '臺鐵',
    '列車',
    '車次',
    '班次',
    '時刻表',
    '誤點',
    '晚分',
    '普悠瑪',
    '太魯閣',
    '自強',
    '莒光',
    '區間車',
    '區間快'
  ];
  if (trainKeywords.some(kw => content.includes(kw))) return true;

  const stationNames = [
    '北車',
    '台北',
    '臺北',
    '板橋',
    '桃園',
    '中壢',
    '新竹',
    '苗栗',
    '台中',
    '臺中',
    '彰化',
    '嘉義',
    '台南',
    '臺南',
    '高雄',
    '屏東',
    '宜蘭',
    '羅東',
    '花蓮',
    '台東',
    '臺東'
  ];
  const routeWords = ['到', '去', '從', '搭', '坐', '乘', '開往'];
  const stationHitCount = stationNames.reduce((count, station) => {
    return content.includes(station.toLowerCase()) ? count + 1 : count;
  }, 0);

  return stationHitCount >= 2 && routeWords.some(word => content.includes(word));
}

function buildSystemPrompt(basePrompt) {
  return `${basePrompt}\n\n${CONVERSATION_MEMORY_RULES}`;
}

async function replyAndRemember(message, content) {
  const replyText = String(content || '').trim();
  if (!replyText) return;

  if (replyText.length > 2000) {
    const chunks = replyText.match(/[\s\S]{1,1990}/g);
    for (const chunk of chunks) {
      await message.reply(chunk);
    }
  } else {
    await message.reply(replyText);
  }

  rememberAssistantReply(message.author.id, replyText);
}

function extractTimeRange(text) {
  if (/早上|上午|morning/i.test(text)) return 'morning';
  if (/下午|afternoon/i.test(text)) return 'afternoon';
  if (/傍晚|黃昏|evening/i.test(text)) return 'evening';
  if (/晚上|夜間|night/i.test(text)) return 'night';
  return null;
}

function extractTime(text) {
  const match = String(text || '').match(/(?:^|[^\d])(\d{1,2}):(\d{2})(?:$|[^\d])/);
  if (!match) return null;
  return `${match[1].padStart(2, '0')}:${match[2]}`;
}

function extractRawDateText(text) {
  const content = String(text || '');
  const relative = content.match(/後天|明天|明日|今天|今日/);
  if (relative) return relative[0];

  const fullDate = content.match(/\b20\d{2}[-/]\d{1,2}[-/]\d{1,2}\b|\b20\d{6}\b/);
  if (fullDate) return fullDate[0];

  const monthDay = content.match(/(?:^|[^\d])(\d{1,2}\s*[\/月]\s*\d{1,2}\s*日?)(?:$|[^\d])/);
  return monthDay ? monthDay[1].replace(/\s+/g, '') : null;
}

function findStationMentions(text) {
  const content = String(text || '');
  const mentions = [];

  for (const candidate of STATION_CANDIDATES) {
    let startIndex = 0;
    while (startIndex < content.length) {
      const index = content.indexOf(candidate, startIndex);
      if (index === -1) break;
      const normalized = normalizeTraStation(STATION_ALIASES[candidate] || candidate);
      if (normalized) {
        mentions.push({
          raw: candidate,
          name: normalized.name,
          index,
          length: candidate.length
        });
      }
      startIndex = index + candidate.length;
    }
  }

  return mentions
    .sort((a, b) => a.index - b.index || b.length - a.length)
    .filter((mention, idx, all) => {
      return !all.some((other, otherIdx) => {
        if (otherIdx === idx) return false;
        return other.index <= mention.index &&
          other.index + other.length >= mention.index + mention.length &&
          other.length > mention.length;
      });
    });
}

function extractTrainArgsFromText(text) {
  const content = String(text || '').replace(/\s+/g, '');
  const mentions = findStationMentions(content);
  const args = {
    rawDateText: extractRawDateText(content),
    timeRange: extractTimeRange(content),
    time: extractTime(content)
  };

  const fromTo = content.match(/從(.+?)(?:到|去|往)(.+?)(?:有|的|$)/);
  if (fromTo) {
    const originMention = findStationMentions(fromTo[1])[0];
    const destinationMention = findStationMentions(fromTo[2])[0];
    if (originMention && destinationMention) {
      args.origin = originMention.name;
      args.destination = destinationMention.name;
      return args;
    }
  }

  if (mentions.length >= 2) {
    args.origin = mentions[0].name;
    args.destination = mentions[1].name;
  }

  return args;
}

async function replyTrainQuery(message, rawArgs, userPrompt) {
  const args = { ...rawArgs };
  const dateResolution = resolveTrainQueryDate({
    userText: `${userPrompt} ${args.rawDateText || ''}`,
    llmDate: args.date
  });
  args.date = dateResolution.queryDate;
  delete args.rawDateText;

  console.log(`[chatgptReply/train] llmDate=${dateResolution.originalDate || ''}`);
  console.log(`[chatgptReply/train] resolvedQueryDate=${dateResolution.queryDate}`);
  console.log('[chatgptReply/train] usingSharedTrainFormatter=true');

  if (!args.origin || !args.destination) {
    await replyAndRemember(message, '請提供出發站和抵達站，例如：苗栗到台北早上。');
    return;
  }

  const trainResult = await searchTraTrains(args);
  console.log(`[chatgptReply/train] resultCount=${trainResult.count || 0}`);

  if (trainResult.error) {
    await replyAndRemember(message, trainResult.message);
    return;
  }

  const embed = buildTrainEmbed(trainResult);
  await message.reply({ embeds: [embed] });
  rememberAssistantReply(message.author.id, `台鐵查詢：${trainResult.origin} 到 ${trainResult.destination}，日期 ${trainResult.date}，共 ${trainResult.count || 0} 班。`);
}

/**
 * 處理 AI 回覆（含台鐵查詢整合）
 */
async function handleAIReply(message) {
  // 檢查是否觸發台鐵 Agent
  const isTrain = shouldTriggerTrainAgent(message);
  const userPrompt = message.content.replace(/<@!?\d+>/g, '').trim();
  const userId = message.author.id;
  const memoryPrompt = buildMemoryPrompt(userId);

  if (isHistoryExportRequest(userPrompt)) {
    rememberUserMessage(userId, userPrompt);
    await replyAndRemember(message, HISTORY_REFUSAL);
    return;
  }

  rememberUserMessage(userId, userPrompt);
  
  try {
    const baseSystemPrompt = isTrain ? TRAIN_AGENT_PROMPT : "你是一個友善的 Discord Bot 助手。";
    const messages = [
      {
        role: "system",
        content: buildSystemPrompt(baseSystemPrompt)
      }
    ];

    if (memoryPrompt) {
      messages.push({
        role: "system",
        content: memoryPrompt
      });
    }

    messages.push({
      role: "user",
      content: userPrompt
    });

    // 準備 OpenAI 請求
    const requestPayload = {
      model: process.env.OPENAI_MODEL || "gpt-3.5-turbo",
      messages,
      max_tokens: 500,
      temperature: 0.7
    };
    
    // 只在觸發台鐵時啟用 Function Calling
    if (isTrain) {
      requestPayload.tools = [
        {
          type: "function",
          function: {
            name: "search_tra_trains",
            description: "查詢台鐵時刻表與即時誤點資訊",
            parameters: {
              type: "object",
              properties: {
                origin: {
                  type: "string",
                  description: "出發站名（支援俗稱）。例：北車、台北、中壢"
                },
                destination: {
                  type: "string",
                  description: "抵達站名（支援俗稱）。例：台中、高雄、花蓮"
                },
                rawDateText: {
                  type: "string",
                  description: "使用者原文中的日期片段，例如 今天、明天、後天、6/4、2026-06-04；沒有日期就留空"
                },
                time: {
                  type: "string",
                  description: "HH:mm 格式，未指定則為現在"
                },
                timeRange: {
                  type: "string",
                  description: "時間段（morning/afternoon/evening/night）",
                  enum: ["morning", "afternoon", "evening", "night"]
                }
              },
              required: ["origin", "destination"]
            }
          }
        }
      ];
      requestPayload.tool_choice = {
        type: "function",
        function: {
          name: "search_tra_trains"
        }
      };
    }
    
    const response = await openai.chat.completions.create(requestPayload);
    console.log(`[chatgptReply] 回應狀態: finish_reason=${response.choices[0].finish_reason}`);
    
    // ============ 處理 Function Calling ============
    if (isTrain && response.choices[0].finish_reason === "tool_calls") {
      const toolCall = response.choices[0].message.tool_calls[0];
      
      if (toolCall.function.name === "search_tra_trains") {
        const args = JSON.parse(toolCall.function.arguments);
        console.log(`[chatgptReply] 台鐵查詢參數:`, args);
        await replyTrainQuery(message, args, userPrompt);
      }
      return;
    }

    if (isTrain) {
      console.warn('[chatgptReply/train] model did not call tool; using local parser fallback');
      const fallbackArgs = extractTrainArgsFromText(userPrompt);
      console.log('[chatgptReply/train] fallbackArgs:', fallbackArgs);
      await replyTrainQuery(message, fallbackArgs, userPrompt);
      return;
    }

    // ============ 一般回覆（非 Function Calling） ============
    const content = response.choices[0].message.content;
    await replyAndRemember(message, content);

  } catch (err) {
    console.error('[chatgptReply] 錯誤:', err.message);
    await replyAndRemember(message, '⚠️ 無法取得回覆，請稍後再試。');
  }
}

module.exports = {
  name: 'messageCreate',
  async execute(message) {
    if (message.author.bot) return;
    if (!message.guild || !message.content) return;

    const isReplyToBot =
      message.reference &&
      (await message.channel.messages.fetch(message.reference.messageId))
        ?.author?.id === message.client.user.id;

    const isMentioningBot = message.mentions.has(message.client.user.id);

    if (!isReplyToBot && !isMentioningBot) return;

    const prompt = message.content
      .replace(new RegExp(`<@!?${message.client.user.id}>`, 'g'), '')
      .trim();
    if (!prompt) return;

    try {
      await message.channel.sendTyping();
      await handleAIReply(message);
    } catch (err) {
      console.error('[chatgptReply] 執行失敗:', err.message);
      await message.reply('⚠️ 無法處理請求，請稍後再試。');
    }
  }
};
