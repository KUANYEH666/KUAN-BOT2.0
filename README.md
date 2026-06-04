# KUAN-BOT2.0

KUAN-BOT2.0 是一個以 Discord.js v14 開發的多功能 Discord Bot，整合 AI 自然語言回覆、臺鐵查詢、台股工具、關鍵字自動回覆、翻譯、遊戲與伺服器管理輔助功能。

## 主要功能

### AI 自然語言聊天

- 支援在 Discord 內 `@Bot` 直接對話。
- 使用 OpenAI API 產生回覆。
- 可辨識部分自然語言需求並轉成工具查詢，例如臺鐵班次查詢。
- 具備短期上下文記憶設計，只保留最近對話重點，不提供完整歷史紀錄查詢。

### 臺鐵查詢

- `/train` 查詢臺鐵班次。
- 支援自然語言查詢，例如：`@Bot 我明天早上要從苗栗到台北有哪些火車`。
- 支援站名正規化，例如 `台北`、`臺北`、`台北車站`、`1008` 等輸入差異。
- 支援日期解析：今天、明天、後天、完整日期。
- 使用官方 ODS JSON / XML 每日時刻表作為排定班表來源。
- 使用 TDX ODFare 查詢票價。
- 使用 TDX TrainLiveBoard 合併即時誤點資訊。
- 靜態班表會快取到 `data/train/schedules/YYYYMMDD.json`。
- 票價與即時資料失敗時不會中斷班次查詢，會保留 fallback。

### 台股工具

- `/twstock_breakout` 查詢台股低位爆量突破掃描結果。
- 支援分頁、下拉選單切換股票。
- 可查看個股 K 線圖連結。
- 可產生個股新聞摘要。
- `/stock_news` 查詢指定台股最新新聞，並使用 AI 產生重點摘要。
- 內含 SQLite / 快取資料流程，可用腳本建立或更新台股資料。

### 關鍵字自動回覆

- 可設定文字或圖片關鍵字回覆。
- `/addkeyword` 新增或更新關鍵字。
- `/deletekeyword` 刪除關鍵字。
- `/listkeywords` 查看關鍵字，支援分頁、搜尋與文字 / 圖片過濾。
- 關鍵字資料儲存在 `src/JSON/keywords.json`。

### 翻譯與訊息工具

- 右鍵訊息可使用 `翻譯訊息`，同時翻譯成繁體中文、英文、日文。
- 右鍵訊息可使用 `偷emoji`，將訊息中的自訂 emoji 或圖片附件加入伺服器。
- `/say` 讓 Bot 代發指定訊息，並記錄到 `message-log.txt`。
- `/ping` 查看 Bot 延遲。

### 遊戲與娛樂

- `/fortune` 每日求籤，每位使用者每天一次。
- `/ultimatenumber` 終極密碼遊戲，可指定對手、範圍並輪流猜數字。

### 管理工具

- `/registerslash` 重新註冊 Slash 指令，可選擇註冊到目前伺服器或全域。
- `/clearslash` 清除目前伺服器的 Slash 指令。
- 管理指令會依 `.env` 中的 `ADMINS` 使用者 ID 清單限制權限。

## 指令一覽

| 指令 | 功能 |
| --- | --- |
| `/train` | 查詢臺鐵班次、票價與即時誤點 |
| `/twstock_breakout` | 查看台股低位爆量突破掃描結果 |
| `/stock_news` | 查詢台股新聞並產生 AI 摘要 |
| `/addkeyword` | 新增或更新關鍵字回覆 |
| `/deletekeyword` | 刪除關鍵字回覆 |
| `/listkeywords` | 查看、搜尋、過濾關鍵字 |
| `/fortune` | 抽今日運勢籤 |
| `/ultimatenumber start` | 開始終極密碼遊戲 |
| `/ultimatenumber guess` | 猜終極密碼數字 |
| `/say` | 讓 Bot 代發訊息 |
| `/ping` | 查看 Bot 延遲 |
| `/registerslash` | 重新註冊 Slash 指令 |
| `/clearslash` | 清除伺服器 Slash 指令 |
| 右鍵 `翻譯訊息` | 翻譯指定訊息 |
| 右鍵 `偷emoji` | 新增訊息中的 emoji 或圖片為伺服器 emoji |

## 安裝與啟動

### 1. 安裝套件

```bash
npm install
```

### 2. 建立環境變數

複製 `.env.example` 為 `.env`，並填入自己的 Token 與 API Key。

```bash
cp .env.example .env
```

Windows PowerShell 可用：

```powershell
Copy-Item .env.example .env
```

### 3. 啟動 Bot

```bash
npm run dev
```

## 環境變數

| 變數 | 用途 |
| --- | --- |
| `DISCORD_TOKEN` | Discord Bot Token |
| `token` | 部分舊程式碼使用的 Discord Bot Token 變數名稱 |
| `OPENAI_API_KEY` | OpenAI API Key |
| `OPENAI_API_BASE` | OpenAI API Base URL，預設可用官方端點 |
| `OPENAI_MODEL` | OpenAI 模型名稱 |
| `ADMINS` | 管理員 Discord 使用者 ID，多人用逗號分隔 |
| `TDX_CLIENT_ID` | TDX Client ID |
| `TDX_CLIENT_SECRET` | TDX Client Secret |
| `TDX_ACCESS_TOKEN` | 可選，已取得的 TDX Bearer Token |
| `TDX_API_KEY` | 可選，舊式或備援 TDX API Key |
| `TRA_REALTIME_CACHE_TTL_MS` | 臺鐵即時資料快取時間 |
| `TRA_FARE_CACHE_TTL_DAYS` | 臺鐵票價快取天數 |

## 臺鐵資料來源

臺鐵功能使用官方資料來源，並依情況 fallback：

1. TDX TrainLiveBoard：即時列車動態與誤點資訊。
2. TDX ODFare：起訖站票價。
3. TRA ODS JSON 每日時刻表：主要排定班表來源。
4. TRA ODS XML 每日時刻表：JSON 無法取得時的備援。
5. 本地 JSON / 快取：最後 fallback，不作為唯一真相來源。

Discord 回覆中的即時資訊仍可能延遲，實際乘車請以臺鐵官方與車站現場資訊為準。

## 台股資料與腳本

可使用以下腳本建立或更新台股資料：

```bash
npm run seed:twstock
```

或使用 Python 版本：

```bash
npm run seed:twstock:py
```

如果要啟動全市場掃描模式：

```bash
npm run dev:fullscan
```

## 專案結構

```text
src/
  commands/              Discord 指令
    context/             右鍵選單指令
    game/                遊戲指令
    tools/               工具型 Slash 指令
  events/client/         Discord 事件處理
  functions/handlers/    指令與事件載入器
  JSON/                  本地 JSON 資料
  scripts/               資料建立腳本
  utils/                 共用工具模組
    trainSchedule/       臺鐵查詢、票價、即時資料、formatter
```

## 注意事項

- 台股資訊與新聞摘要僅供參考，不構成投資建議。
- 管理員指令請正確設定 `ADMINS`，避免未授權使用。

