# 🚆 台鐵通勤精靈 - 實裝指南

## 📋 概述

你的 KUAN-BOT2.0 已成功整合「台鐵通勤精靈」功能，包含：

✅ **Layer 3**: `/train` 斜線指令（UI 版本）  
✅ **Layer 4**: `@mention` 自然語言查詢（Function Calling）  
✅ **Layer 5**: `twTraData.js` 核心查詢模組  
✅ **Layer 6**: 多層快取系統（L1 靜態 + L2 動態誤點）

---

## 🚀 快速開始

### 1️⃣ 環境變數設置

複製 `.env.example` 到 `.env`，並填入你的設置：

```bash
cp .env.example .env
```

編輯 `.env` 檔案：

```env
DISCORD_TOKEN=your_bot_token
OPENAI_API_KEY=sk-xxxxx
OPENAI_MODEL=gpt-3.5-turbo
TDX_API_KEY=your_ptx_api_key  # 📌 重要：需申請 PTX API Key
```

### 2️⃣ 申請 PTX API Key（可選但推薦）

**PTX 公共運輸整合平台** 提供最新、最準確的台鐵數據。

申請步驟：
1. 造訪 https://ptx.transportdata.tw/PTX/apply
2. 填寫申請表，選擇「臺灣鐵路」服務
3. 審核通過後將收到 **AppID** 與 **AppKey**
4. 在 `.env` 中設置 `TDX_API_KEY=你的AppKey`

> **沒有 PTX API Key？** 系統會自動降級使用本地 `tra_schedule.json` 資料。

### 3️⃣ 依賴檢查

確保已安裝 `node-cache`（已自動安裝）：

```bash
npm list node-cache
```

---

## 💬 使用方式

### 方式 1️⃣: 斜線指令 (推薦用於快速查詢)

```
/train 出發站:北車 抵達站:台中 日期:2026-05-09 時段:morning
```

**參數說明：**
- `出發站` (必填): 台北、北車、新竹、中壢、台中、高雄、花蓮等
- `抵達站` (必填): 同上
- `日期` (可選): YYYY-MM-DD 格式，留空為今天
- `時間` (可選): HH:mm 格式，留空為現在
- `時段` (可選): morning / afternoon / evening / night

**回應示例：**
```
🚉 臺北 ➡️ 臺中 | 📅 2026-05-09
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔴 **07:20 ➔ 09:35** | 1601 普悠瑪 | ⏱️ 2h15m | 💰 $630
🔴 **08:30 ➔ 10:45** | 1603 普悠瑪 | ⏱️ 2h15m | 💰 $630 [⚠️ 晚分 5 分]
🔵 **09:00 ➔ 11:30** | 2165 區間快 | ⏱️ 2h30m | 💰 $370
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
💡 *數據更新時間：2026-05-09 06:15:30*
```

---

### 方式 2️⃣: @mention 自然語言 (推薦用於手機端)

直接在 Discord 頻道中 @Bot，用自然語言描述你的乘車需求：

```
@Bot 幫我查明天早上北車到台中的火車
@Bot 查今天下午從新竹到高雄的班次
@Bot 晚上有台中到花蓮的列車嗎？
```

系統將自動：
1. 透過 OpenAI GPT 識別意圖
2. 利用 Function Calling 呼叫 `search_tra_trains` 工具
3. 格式化結果為 Discord Markdown

---

## 🎨 輸出格式說明

### 顏色代碼

| 顏色 | 列車類型 | 說明 |
|------|---------|------|
| 🔴 紅 | 普悠瑪、太魯閣、自強 | 快速列車，票價最高 |
| 🔵 藍 | 區間快、復興 | 中速列車 |
| 🟠 橙 | 莒光號、平快、區間車 | 普通列車，票價最低 |

### 誤點警示

若列車有誤點資訊（來自 TDX 動態資料）：
```
[⚠️ 晚分 X 分]  → 表示列車遲延 X 分鐘
```

---

## 📊 架構細節

### 數據來源優先級

```
PTX API (即時 + 誤點)
    ↓ (若無 API Key)
本地時刻表 JSON (靜態)
    ↓
錯誤處理 → 回傳無結果訊息
```

### 快取策略

| 層級 | 用途 | TTL | 儲存位置 |
|------|------|-----|---------|
| **L1** | 時刻表靜態快取 | 24h | Node-cache |
| **L2** | TDX 誤點資訊 | 15m | Node-cache |
| **Rate Limit** | 防止濫用 | 24h | Node-cache |

### 流程圖

```
[用戶訊息] 
  ↓
[chatgptReply.js]
  ↓
[OpenAI Function Calling] → [意圖識別]
  ↓
[searchTraTrains()] in twTraData.js
  ├─ [Normalize] (車站正規化)
  ├─ [Rate Limit Check]
  ├─ [Try PTX API]
  ├─ [Fallback to Local JSON]
  ├─ [Filter by Time Range]
  └─ [Merge Delay Info]
  ↓
[Format Result]
  ↓
[Discord Reply]
```

---

## ⚙️ 進階配置

### 修改 Rate Limit 限額

編輯 `src/utils/twTraData.js`：

```javascript
const CONFIG = {
  MAX_QUERIES_PER_DAY: 1000,    // 日限額
  MAX_QUERIES_PER_MINUTE: 5,    // 分鐘限制
  // ...
};
```

### 添加更多車站別名

編輯 `src/utils/twTraData.js` 中的 `STATION_ALIASES`：

```javascript
const STATION_ALIASES = {
  "台北": "臺北",
  "北車": "臺北",
  "新莊": "新莊",  // 新增
  // ...
};
```

### 更新 PTX 站碼映射

編輯 `getPTXStationCode()` 函式：

```javascript
function getPTXStationCode(stationName) {
  const ptxStationMap = {
    "臺北": "1000",
    "新竹": "1004",
    // 新增更多站碼...
  };
  return ptxStationMap[stationName] || null;
}
```

> **PTX 站碼查詢：** https://ptx.transportdata.tw/MOTC/v2/Rail/Station?$format=JSON

---

## 🧪 測試

### 單元測試（手動）

在 Discord 頻道中測試：

```
✅ 斜線指令測試
/train 出發站:北車 抵達站:台中

✅ 自然語言測試
@Bot 查北車到台中的火車

✅ 邊界情況
@Bot 查明年12月的班次（應返回無結果）
@Bot 查3點到新竹（自動轉換時間格式）
```

### 檢查日誌

查看 Console 輸出：
```
[twTraData] 收到查詢請求: { origin: '北車', destination: '台中', ... }
[twTraData] 嘗試使用 PTX API...
[twTraData] 查詢成功 (PTX API)，回傳 5 班車
```

---

## 🐛 常見問題

### Q1: 「系統目前查無符合條件的車次」

**可能原因：**
- ❌ 車站名稱錯誤或不被識別
- ❌ 查詢時間已過（例：查詢下午 6 點，但現在已晚上 8 點）
- ❌ 該日期沒有班次（例：查詢未來 3 個月的班次）

**解決方案：**
1. 確認車站名稱（北車 ≠ 台北車站，系統會自動轉換）
2. 嘗試提早時間（改成上午或中午）
3. 使用「時段」參數代替精確時間

### Q2: Rate Limit 被觸發

**症狀：** 「查詢次數暫時達到限制」

**解決方案：**
- 這是保護措施，防止 API 濫用
- 等待 24 小時後自動重設
- 或修改 `CONFIG.MAX_QUERIES_PER_DAY`

### Q3: PTX API 無法連線

**症狀：** 系統只使用本地 JSON 資料

**排查步驟：**
1. 確認 `.env` 中的 `TDX_API_KEY` 已正確設置
2. 檢查網路連線
3. 驗證 PTX 平台狀態：https://ptx.transportdata.tw/

### Q4: 自然語言識別不準確

**範例：**
```
❌ @Bot 查台北去台中
✅ @Bot 幫我查台北到台中的火車
```

**原因：** OpenAI 需要更多上下文

**改進：** 提供更完整的句子

---

## 📚 相關資源

| 資源 | 連結 |
|------|------|
| **PTX 平台** | https://ptx.transportdata.tw/ |
| **Dataset 6138** | https://data.gov.tw/dataset/6138 |
| **台鐵官網** | https://www.railway.gov.tw/ |
| **Discord.js 文件** | https://discord.js.org/ |
| **OpenAI Function Calling** | https://platform.openai.com/docs/guides/function-calling |

---

## ✨ 下一步優化建議

1. **完整 PTX 站碼映射**：目前只有部分主要車站，可擴充至所有 100+ 車站
2. **轉乘建議**：若查無直達班次，自動提供轉乘方案
3. **票價比較**：並排顯示不同列車類型的票價差異
4. **車況推播**：定期掃描誤點資訊，推播給訂閱用戶
5. **購票整合**：提供一鍵跳轉至 Kktix / ezTravel 購票連結

---

**🎉 實裝完成！準備好迎接用戶的查詢了！**

有任何疑問或需要進一步優化，隨時告訴我 🚀
