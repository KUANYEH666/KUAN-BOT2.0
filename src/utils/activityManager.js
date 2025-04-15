const fs = require('fs');
const path = require('path');
const { ActivityType } = require('discord.js');

const songsPath = path.join(__dirname, '../JSON/songs.json');
const songData = JSON.parse(fs.readFileSync(songsPath, 'utf8'));

const categories = Object.keys(songData);
let currentCategory = null;

let allSongs = Object.values(songData).flat();
let currentIndex = -1;
let songHistory = [];
let currentCooldown = false;
const COOLDOWN_MS = 60 * 1000;

// ⏱️ 自動輪播
function startAutoUpdate(client, interval = 5 * 60 * 1000) {
  playNext(client);
  setInterval(() => playNext(client), interval);
}

// ▶️ 播放歌曲並更新狀態
function updateListeningActivity(client, song) {
  client.user.setActivity(song, { type: ActivityType.Listening });
  console.log(`🎶 狀態更新為：${song}`);
}

// 🎵 播放下一首（隨機）
function playNext(client) {
  const source = currentCategory ? songData[currentCategory] : allSongs;
  const next = Math.floor(Math.random() * source.length);
  currentIndex = next;
  const song = source[currentIndex];
  songHistory.push({ index: currentIndex, category: currentCategory });
  updateListeningActivity(client, song);
}

// ⏪ 播放上一首
function playPrevious(client) {
  if (songHistory.length < 2) return;
  songHistory.pop(); // 移除目前
  const { index, category } = songHistory[songHistory.length - 1];
  currentCategory = category || null;
  const source = category ? songData[category] : allSongs;
  currentIndex = index;
  updateListeningActivity(client, source[currentIndex]);
}

// 🎲 隨機播放（不記錄歷史）
function playRandom(client) {
  const source = currentCategory ? songData[currentCategory] : allSongs;
  const song = source[Math.floor(Math.random() * source.length)];
  updateListeningActivity(client, song);
}

// 🧠 處理手動輸入訊息（包含全形驚嘆號）
function handleManualNext(message, client) {
  if (message.author.bot) return;

  const content = message.content.trim().replace(/^！/, '!');

  // ✅ 只處理播放相關指令
  if (!/^!下一首$|^!上一首$|^!隨機播放$|^!播放 .+/.test(content)) return;

  // 🟢 ⏪ 上一首不設冷卻
  if (content === '!上一首') {
    playPrevious(client);
    message.reply('⏮️ 回到上一首！');
    return;
  }

  // 🛑 其他指令進入冷卻檢查
  if (currentCooldown) {
    message.reply('⏳ 冷卻中，請稍後再試。');
    return;
  }

  // 🧠 播放指令處理（需冷卻）
  if (content === '!隨機播放') {
    playRandom(client);
    message.reply('🎲 隨機播放一首！');
  } else if (content.startsWith('!播放 ')) {
    const category = content.split(' ')[1];
    if (!categories.includes(category)) {
      return message.reply(`❌ 類別 \`${category}\` 不存在，請確認拼字。`);
    }
    currentCategory = category;
    playNext(client);
    message.reply(`📁 已切換至分類 \`${category}\` 播放！`);
  } else if (content === '!下一首') {
    playNext(client);
    message.reply('▶️ 播放下一首！');
  }

  currentCooldown = true;
  setTimeout(() => (currentCooldown = false), COOLDOWN_MS);
}


// 🧩 提供分類與清單給 /listplaylist 用
function getAllPlaylists() {
  return songData; // { Roselia: [...], MyGO: [...], ... }
}

module.exports = {
  startAutoUpdate,
  handleManualNext,
  getAllPlaylists
};
