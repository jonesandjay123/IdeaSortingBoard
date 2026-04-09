# Idea Sorting Board（想法分類板）

一個單頁的教學工具,用來把模糊的想法變成可以拖曳、翻譯的小卡,並在不同
的分類框架之間來回切換。專門為了課堂上那個「這個功能算簡單還是難?」
的當下而做,完全不需要碰程式碼。

## 怎麼跑起來

需要 **Node 18 以上**(`@google/genai` SDK 的要求)。

```bash
npm install
cp .env.example .env
# 把 .env 裡的 VITE_GEMINI_API_KEY 換成你自己的金鑰
npm run dev
```

打開 http://localhost:5173。

第一次載入會自動 seed 5 張繁中 demo 卡 + 三個預設 snapshot。右邊是
未分類的小卡池,中間是 column,把卡拖進你想放的欄位就行。

所有卡片和 snapshot 都存在你瀏覽器裡(IndexedDB),只有**翻譯**的
時候會把那張卡的文字送去 Google Gemini,其他操作完全離線。

### 關於 Gemini API 金鑰

可以到 <https://aistudio.google.com/apikey> 申請一把免費的 key。
拿到之後貼進 `.env` 檔案就好:

```
VITE_GEMINI_API_KEY=你的金鑰
```

注意幾件事:

- `.env` 已經在 `.gitignore` 裡,不會被 commit 進 repo。
- 環境變數名稱**必須**是 `VITE_GEMINI_API_KEY`。Vite 只會把 `VITE_`
  開頭的變數注入進前端程式碼,換名字就讀不到了。
- 這個 app 沒有後端,金鑰會被打包進瀏覽器的 JS。本機/教室裡自己用沒
  問題,但**不要把這個 repo 部署到公開網址**,不然別人打開 DevTools
  就看得到你的 key。

## 三個預設框架在幹嘛

第一次載入會自動建立三個框架:

1. **Yes / No** — 最簡單的二分題。起手式:「這件事我們到底做不做得
   到?」
2. **Easy / Medium / Hard / Impossible** — 本工具的主戰場。目的是
   訓練對功能難度的直覺。把每張小卡拖進對應的難度,為邊緣案例爭論。
3. **Now / Later / Never** — 換個視角做優先順序。同一堆想法,新的
   問題。

真正的魔法是在對話中**切換不同的 snapshot**,讓同一堆想法在不同問題
下反覆出現,逼自己用不同角度看同一件事。

## 資料模型(為什麼這東西不會壞)

IndexedDB 裡(用 Dexie 包)有三個邏輯表:

- `cards` — 小卡內容的單一真相來源。每張小卡有固定 id。編輯文字或
  翻譯只會動到這張表,所有 snapshot 因為都是用 id 參照,會自動反映
  變更。
- `snapshots` — 每個分類視圖一筆,各自儲存自己的 `layout` JSON:

  ```json
  {
    "columns": [
      { "id": "col_1", "name": "Yes", "cardIds": ["card_a", "card_b"] },
      { "id": "col_2", "name": "No",  "cardIds": ["card_c"] }
    ],
    "unplacedCardIds": ["card_d"]
  }
  ```

  同一張小卡可以在不同 snapshot 裡落在不同 column。
- `settings` — 小小的 key/value 包(目前 snapshot id、預設語言、
  seed 旗標)。

**這個設計自動處理的邊緣情境**:

- 刪一張卡 → 從 `cards` 移除,所有 snapshot 的 layout 都會掃掉它的
  id。
- 刪一個 column → 裡面的卡**不會被刪**,而是掉回該 snapshot 的
  `unplacedCardIds`,絕對不會有小卡無聲消失的事。
- 刪一個 snapshot → 小卡本身完全不動;目前 snapshot 自動切到另一
  個還存在的。
- 改名任何東西 → 只動一筆,所有參照都是用 id,不會對不到。
- 新增一張卡 → 會自動出現在**每個 snapshot 的 unplaced 池**,所以
  切換框架時看到的永遠是同一堆想法。

## 翻譯(Gemini 2.5 Flash)

`src/services/translationService.js` 對外只有一個 async 函式:

```js
translate(text, sourceLang, targetLang) => Promise<string>
```

底下呼叫的是 Google 官方的 `@google/genai` SDK,模型用
`gemini-2.5-flash`。Prompt 被刻意寫得很嚴:只回傳翻譯本身,不要
引號、不要說明、不要語言標籤、不要羅馬拼音,如果 AI 還是手賤加了
引號進來,我們這邊會再 strip 一次。

**觸發時機**:新增一張卡按下 Create、或編輯完按下 Save 以後,會在
背景送去翻譯;卡片會先顯示「翻譯中…」的 loading 狀態,翻好再換成
結果。`actions.js` 有一個 stale-response guard,會確認回來的翻譯
對應的還是最新的文字,不會讓慢吞吞的舊翻譯覆蓋掉剛改好的新內容 ——
所以你可以放心在短時間內連改好幾次。

**要換成別的翻譯引擎的時候**,只要改 `translate()` 的函式本體,保持
一樣的 signature 就好。App 的其他地方都不用動。

目前支援的語言:`zh-Hant`、`zh-Hans`、`en`、`ja`。想加更多語言的
話,在同一個檔案擴充 `SUPPORTED_LANGUAGES` 和 `LANGUAGE_PROMPT_NAMES`
就好。

## 介面小技巧

- **⌘/Ctrl + Enter**:在新增卡片 modal 裡直接送出
- **Esc**:關掉 modal
- **雙擊 column 標題**:直接改名
- **右上角 ☀️/🌙 按鈕**:切換深色/淺色模式。預設是深色(保護眼睛),
  選擇會存在 localStorage,下次打開會記得。

## 專案結構

```
src/
├── main.jsx                  React 入口
├── App.jsx                   Seeding gate + 掛載 <Board>
├── db/
│   ├── database.js           Dexie schema + settings helper
│   └── actions.js            所有的 mutation(cards、snapshots、columns、placement)
├── services/
│   └── translationService.js Gemini 2.5 Flash 翻譯實作(`@google/genai`)
├── lib/
│   ├── seedData.js           第一次啟動的預設資料
│   └── theme.js              用 localStorage 記憶的深色/淺色切換
├── components/
│   ├── Board.jsx             最上層版面 + DndContext + 拖曳 handler
│   ├── Toolbar.jsx           Snapshot 選擇器 + 主題切換 + 新增/改名/刪除
│   ├── Column.jsx            一個可拖曳放下的 column
│   ├── Card.jsx              可排序的想法小卡 + 給 DragOverlay 用的 CardPreview
│   ├── SidePanel.jsx         右側「未分類小卡池」
│   └── CardModal.jsx         新增/編輯 modal
└── styles/
    └── app.css               所有樣式;主題用 CSS 變數,:root 是深色
```

## 技術棧

React 18 + Vite · Dexie (IndexedDB) + `dexie-react-hooks` 做響應式
讀取 · `@dnd-kit/core` + `@dnd-kit/sortable` 做多容器拖曳 ·
`@google/genai` 接 Gemini 2.5 Flash 做翻譯 · 純 CSS 搭配變數(容易
換主題,不需要 Tailwind 的雜訊)。

## 需要重置時

想要全部清掉重 seed 的話,打開瀏覽器 DevTools → Application →
IndexedDB → 刪掉 `IdeaSortingBoard` 資料庫 → 重新整理頁面。

## 給下一個 Claude session 看的

如果你是 Claude Code CLI 開起來的 session,先讀 `CLAUDE.md`。那裡面
有資料模型的 invariant、不要亂動的地方,還有接下來最可能踩到的坑。
