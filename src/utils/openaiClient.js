const { OpenAI } = require('openai');
require('dotenv').config();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: process.env.OPENAI_API_BASE, // ✅ 自訂平台必填
});


async function getChatGPTReply(prompt, model = process.env.OPENAI_MODEL || 'gpt-3.5-turbo') {
  const chat = await openai.chat.completions.create({
    model,
    messages: [{ role: 'user', content: prompt }],
    max_tokens: 100,
    temperature: 0.7,
  });

  return chat.choices[0].message.content.trim();
}

module.exports = { getChatGPTReply };
