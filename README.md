# Idea Sorting Board（想法分類板）

> Languages: **繁體中文** · [日本語](./README.ja.md)

一個單頁的教學工具,用來把模糊的想法變成可以拖曳、翻譯的小卡,並在不同
的分類框架之間來回切換。專門為了課堂上那個「這個功能算簡單還是難?」
的當下而做,完全不需要碰程式碼。

除了分類本身,它還會根據你在板子上擺放卡片的方式,讓 Gemini **自動抽
一份具體的 project 提案**給你 —— 把整理的過程變成一個可以反覆「抽卡」
的發想工具。

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

所有卡片、snapshot、還有生成出來的 proposal 都存在你瀏覽器裡
(IndexedDB),只有**翻譯**和**生成 project 提案**的時候會把相關文字
送去 Google Gemini,其他操作完全離線。**語音輸入**走 Chrome 原生 Web
Speech API,不會消耗任何 AI token。

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

IndexedDB 裡(用 Dexie 包)有四個邏輯表:

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
- `proposals` — Gemini 根據某個 snapshot 的排列方式生成出來的 project
  提案。每按一次「抽一張」就會產生一筆,**把當時 board 的樣子凍結
  起來**(`layoutSnapshot`),所以你之後怎麼搬卡、怎麼改欄位名,回頭
  看舊提案都還是看得到它當初是根據什麼產出的。

**這個設計自動處理的邊緣情境**:

- 刪一張卡 → 從 `cards` 移除,所有 snapshot 的 layout 都會掃掉它的
  id。proposals **刻意不掃** —— 凍結輸入是那個功能的核心。
- 刪一個 column → 裡面的卡**不會被刪**,而是掉回該 snapshot 的
  `unplacedCardIds`,絕對不會有小卡無聲消失的事。
- 刪一個 snapshot → 小卡本身完全不動;目前 snapshot 自動切到另一
  個還存在的。該 snapshot 底下的 proposal 會在**同一個 transaction**
  裡一併刪掉(沒有 parent 的 proposal 沒有意義)。
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

## 抽企劃卡(Project proposals)

工具列右上角的 **💡 Proposals** 按鈕會打開一個全螢幕的報告 modal。
按左下角的「🎲 抽一張新的」,Gemini 會讀**目前 snapshot 板子上被放進
欄位的卡**(右邊那個未分類池子**刻意不讀**,因為還沒被判斷的卡沒有
訊號),然後產出一份具體的 project 提案:

- **title** — 一個具體的 project 名稱,不是分類詞
- **為什麼是這個** — 兩到四句說明為什麼這個組合值得做
- **MVP 起手式** — 三個具體的第一步
- **為什麼現在適合做** — 一句話版的 pitch
- **tags** — 兩到四個短標籤
- **根據當時 board 上的這些卡片** — 當下欄位 + 卡片的凍結快照,
  之後再回頭看還能完整對上當時的情境

每按一次就生成一張新的 proposal,存成歷史可以回頭點開比較。左側歷史
列表 hover 會出現 × 刪除。**反覆抽卡**是這個功能的靈魂:為了避免每
次只是換句話說,`generateProposal` 會把同 snapshot 最近 5 筆已完成
的 proposal 的 title + rationale 一起塞進 prompt,明確告訴 Gemini
「避開這些已經講過的角度」,加上溫度拉到 1.1,讓每次抽卡真的有不同
的方向。

實作在 `src/services/proposalService.js`,跟 `translationService.js`
並列但各自獨立(翻譯的 contract 很嚴格,不該混進其他 Gemini 呼叫)。
輸出是結構化 JSON(`responseMimeType: 'application/json'`),有防呆
的 fallback parser 應付模型偶爾手滑包 ```json 或加逗號的情況。
Token 消耗很小 —— 每次 prompt < 2 KB、response < 2 KB,以
gemini-2.5-flash 的價格實際上接近免費,可以放心反覆刷。

## 語音輸入(麥克風按鈕)

新增/編輯卡片的 modal 裡,「Idea」標籤旁邊會有一顆小小的 `🎤 Voice`
按鈕。按下去開始錄,textarea 下方會即時顯示正在辨識中的文字(interim
results);每辨識完一個句子,句子會自動附加到 textarea 裡。再按一次
停止,錄音中按鈕會變成紅色脈動狀態。

這功能走的是 Chrome 原生的 **Web Speech API**(`webkitSpeechRecognition`),
**完全不消耗任何 AI token**,也不用任何額外的套件依賴。只在 Chrome /
Chromium Edge 上可用,其他瀏覽器會自動偵測然後直接隱藏按鈕,不會崩。
辨識語言會跟著你在 modal 裡選的 source language 走(`zh-Hant` →
`zh-TW`、`ja` → `ja-JP` 等),所以跟妹妹討論點子時可以直接用說的,
不用一邊打字一邊怕打錯。

實作在 `src/lib/useSpeechRecognition.js`,是一個薄薄的 hook,
contract 是 `{ supported, listening, interim, error, start, stop,
toggle }` 加一個 `onFinalChunk` callback。如果之後想換成其他 STT
backend,只要保持這個 contract 就行。

## 介面小技巧

- **⌘/Ctrl + Enter**:在新增卡片 modal 裡直接送出
- **Esc**:關掉 modal
- **雙擊 column 標題**:直接改名
- **右上角 ☀️/🌙 按鈕**:切換深色/淺色模式。預設是深色(保護眼睛),
  選擇會存在 localStorage,下次打開會記得。深色模式整體是「深紫板底
  +赤陶橘卡片」的 warm-on-cool 配色:卡片正文是純白、翻譯是 78% 白,
  靠透明度做主譯之間的層級而不是字級;淺色模式則改用中性的白底卡片
  與灰階文字,不繼承橘色。
- **Column 頂端的小點點握把**:按住往左右拖,可以重新排列欄位順序
  (例如把 Yes/No 的左右對調)。平常幾乎看不見,hover 到欄位上時會
  浮出來,直接 hover 到握把上會整個亮起來。
- **欄位列最後面的虛線框「+ Add column」**:點下去就能在目前這個
  snapshot 新增欄位,不用回頭找工具列按鈕。工具列那個按鈕也還在,
  兩個入口並存。
- **右邊卡片池的左邊緣**:滑到最左邊那條細線時游標會變成左右箭頭,
  按住往左右拖可以調整卡片池的寬度。寬度會存在 localStorage,下次
  打開會記得。
- **工具列的 💡 Proposals 按鈕**:打開 proposal reader,按「抽一張
  新的」讓 Gemini 根據當下的排列給你一個 project 點子。同一個
  snapshot 下的歷史會留著,可以回頭看、也可以從左側列表刪除。
- **CardModal 的 🎤 Voice 按鈕**:在新增/編輯小卡的 modal 裡,點
  Idea 旁邊的小按鈕就能語音輸入,用說的代替打字。再按一次停止。
  只在 Chrome 系瀏覽器看得到這顆按鈕。
- **Modal 框選文字**:在 modal 內部框選文字的時候,就算你的游標拖到
  了 modal 外面才鬆開滑鼠,**modal 不會被意外關掉**(經典的
  drag-select 炸彈已經處理過了)。

## 專案結構

```
src/
├── main.jsx                   React 入口
├── App.jsx                    Seeding gate + 掛載 <Board>
├── db/
│   ├── database.js            Dexie schema(v2,含 proposals)+ settings helper
│   └── actions.js             所有的 mutation(cards、snapshots、columns、placement、proposals)
├── services/
│   ├── translationService.js  Gemini 2.5 Flash 翻譯實作(`@google/genai`)
│   └── proposalService.js     Gemini 2.5 Flash「抽企劃卡」生成器
├── lib/
│   ├── seedData.js            第一次啟動的預設資料
│   ├── theme.js               用 localStorage 記憶的深色/淺色切換
│   └── useSpeechRecognition.js Chrome Web Speech API 的薄 hook
├── components/
│   ├── Board.jsx              最上層版面 + DndContext + 欄位水平排序 + 拖曳 handler
│   ├── Toolbar.jsx            Snapshot 選擇器 + 主題切換 + 💡 Proposals 按鈕
│   ├── Column.jsx             可拖曳重排的 column(頂端握把)+ 內部的卡片放置區
│   ├── Card.jsx               可排序的想法小卡 + 給 DragOverlay 用的 CardPreview
│   ├── SidePanel.jsx          右側「未分類小卡池」,可拖曳調整寬度
│   ├── CardModal.jsx          新增/編輯 modal(含麥克風按鈕)
│   └── ProposalModal.jsx      全螢幕 proposal reader(左歷史、右報告)
└── styles/
    └── app.css                所有樣式;主題用 CSS 變數,:root 是深色
```

## 技術棧

React 18 + Vite · Dexie (IndexedDB) + `dexie-react-hooks` 做響應式
讀取 · `@dnd-kit/core` + `@dnd-kit/sortable` 做多容器拖曳 ·
`@google/genai` 接 Gemini 2.5 Flash 做翻譯 **和** 提案生成 · Chrome
原生 Web Speech API 做語音輸入(零 token、零 dependency) · 純 CSS
搭配變數(容易換主題,不需要 Tailwind 的雜訊)。

## 需要重置時

想要全部清掉重 seed 的話,打開瀏覽器 DevTools → Application →
IndexedDB → 刪掉 `IdeaSortingBoard` 資料庫 → 重新整理頁面。

## 給下一個 Claude session 看的

如果你是 Claude Code CLI 開起來的 session,先讀 `CLAUDE.md`。那裡面
有資料模型的 invariant、不要亂動的地方,還有接下來最可能踩到的坑。
