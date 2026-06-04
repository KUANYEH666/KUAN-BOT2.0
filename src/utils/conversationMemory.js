const MAX_ITEMS = 10;
const MAX_TEXT_LENGTH = 500;
const HISTORY_REFUSAL_SNIPPET = '我不能列出完整歷史紀錄';

const memoryByUser = new Map();

function getMemory(userId) {
  const key = String(userId || 'unknown');
  if (!memoryByUser.has(key)) {
    memoryByUser.set(key, {
      userId: key,
      recentContext: [],
      recentQuestions: []
    });
  }
  return memoryByUser.get(key);
}

function trimItems(items) {
  while (items.length > MAX_ITEMS) {
    items.shift();
  }
}

function compactText(text) {
  const normalized = String(text || '')
    .replace(/\s+/g, ' ')
    .trim();

  if (normalized.length <= MAX_TEXT_LENGTH) return normalized;
  return `${normalized.slice(0, MAX_TEXT_LENGTH - 1)}…`;
}

function isQuestion(text) {
  const content = String(text || '').trim();
  if (!content) return false;

  return (
    /[?？]$/.test(content) ||
    /(嗎|呢|為什麼|怎麼|如何|可不可以|能不能|是不是|有沒有|請問|幫我)/.test(content)
  );
}

function isMemoryNoise(text) {
  return String(text || '').includes(HISTORY_REFUSAL_SNIPPET);
}

function rememberUserMessage(userId, text) {
  const content = compactText(text);
  if (!content || isMemoryNoise(content)) return;

  const memory = getMemory(userId);
  memory.recentContext.push(`使用者：${content}`);
  trimItems(memory.recentContext);

  if (isQuestion(content)) {
    memory.recentQuestions.push(content);
    trimItems(memory.recentQuestions);
  }
}

function rememberAssistantReply(userId, text) {
  const content = compactText(text);
  if (!content || isMemoryNoise(content)) return;

  const memory = getMemory(userId);
  memory.recentContext.push(`助手：${content}`);
  trimItems(memory.recentContext);
}

function getMemorySnapshot(userId) {
  const memory = getMemory(userId);
  return {
    userId: memory.userId,
    recentContext: [...memory.recentContext],
    recentQuestions: [...memory.recentQuestions]
  };
}

function buildMemoryPrompt(userId) {
  const snapshot = getMemorySnapshot(userId);
  const sections = [];
  const recentContext = snapshot.recentContext.filter(item => !isMemoryNoise(item));
  const recentQuestions = snapshot.recentQuestions.filter(item => !isMemoryNoise(item));

  if (recentContext.length > 0) {
    sections.push(`最近上下文（最多 10 筆，只能用於理解目前問題）：\n${recentContext.join('\n')}`);
  }

  if (recentQuestions.length > 0) {
    sections.push(`最近問題記憶（最多 10 筆，只能用於承接目前問題）：\n${recentQuestions.join('\n')}`);
  }

  if (sections.length === 0) return '';
  return sections.join('\n\n');
}

function isHistoryExportRequest(text) {
  const content = String(text || '').trim();
  if (!content) return false;

  const historyTargets = [
    '聊天紀錄',
    '聊天記錄',
    '對話紀錄',
    '對話記錄',
    '問題紀錄',
    '問題記錄',
    '詢問歷史',
    '歷史問題',
    '所有問題',
    '全部問題',
    '完整歷史',
    '完整聊天',
    '之前問過什麼',
    '之前所有問題'
  ];
  const exportActions = ['列出', '顯示', '輸出', '匯出', '查詢', '查看', '給我', '全部', '完整'];

  return historyTargets.some(target => content.includes(target)) &&
    exportActions.some(action => content.includes(action));
}

module.exports = {
  rememberUserMessage,
  rememberAssistantReply,
  getMemorySnapshot,
  buildMemoryPrompt,
  isHistoryExportRequest
};
