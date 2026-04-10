# Idea Sorting Board（アイデア仕分けボード）

> Languages: [繁體中文](./README.md) · **日本語**

ぼんやりしたアイデアを、ドラッグ＆ドロップできる翻訳付きのカードに
変えて、複数の分類フレームを切り替えながら並べ替えていく、1 ページ
だけのシンプルな教育ツールです。「この機能は簡単？難しい？」という
授業中のあの瞬間のために作ってあり、コードを書く必要は一切ありません。

仕分けそのものに加えて、ボード上のカードの置き方をもとに Gemini が
**具体的なプロジェクト提案を自動で引き出してくれる**機能も付いてい
ます。整理するプロセスそのものを、何度でも「カードを引き直せる」
アイデア発想ツールに変えてしまう仕組みです。

## 起動方法

**Node 18 以上**が必要です（`@google/genai` SDK の要件）。

```bash
npm install
cp .env.example .env
# .env の VITE_GEMINI_API_KEY を自分のキーに書き換える
npm run dev
```

<http://localhost:5173> を開いてください。

初回起動時に、繁体字中国語のデモカード 5 枚と既定の snapshot 3 つが
自動で seed されます。右側が未分類のカードプール、中央が column で、
やりたい分類の欄にカードをドラッグするだけです。

カード・snapshot・生成された proposal はすべてブラウザ内
（IndexedDB）に保存され、**翻訳**と**プロジェクト提案の生成**のとき
だけテキストが Google Gemini に送信されます。それ以外の操作は完全に
オフラインです。**音声入力**は Chrome ネイティブの Web Speech API を
使っているので、AI トークンは一切消費しません。

### Gemini API キーについて

<https://aistudio.google.com/apikey> から無料のキーが取得できます。
取得したら `.env` に貼り付けるだけ:

```
VITE_GEMINI_API_KEY=取得したキー
```

注意点:

- `.env` はすでに `.gitignore` に入っているので commit されません。
- 環境変数名は**必ず** `VITE_GEMINI_API_KEY` にしてください。Vite は
  `VITE_` プレフィックスが付いた変数しかフロントエンドコードに
  注入しないので、名前を変えると読み取れなくなります。
- このアプリにはバックエンドがないので、キーはブラウザの JS バンドル
  に含まれます。ローカル/教室で自分用に使うぶんには問題ありませんが、
  **公開 URL にデプロイしないでください**。DevTools を開かれたら
  キーが見えてしまいます。

## 既定の 3 つのフレーム

初回起動時に自動で作成される 3 つのフレーム:

1. **Yes / No** — 一番シンプルな二択。起点は「そもそもこれ、本当に
   できるのか？」
2. **Easy / Medium / Hard / Impossible** — このツールの主戦場。
   機能難易度に対する直感を鍛えるのが目的です。カード 1 枚ずつを
   難易度の欄に入れながら、微妙なケースについて議論します。
3. **Now / Later / Never** — 視点を変えた優先順位付け。同じアイデア
   の山に、新しい問いを投げかけます。

本当の魔法は、会話中に**snapshot を切り替える**ことで、同じアイデア
の山が異なる問いの下で何度も現れ、同じ物事を違う角度で見ることを
強制される点にあります。

## データモデル（なぜ壊れないか）

IndexedDB に（Dexie でラップした）4 つの論理テーブルがあります:

- `cards` — カード内容の唯一の真実のソース。各カードには固定 id が
  あります。テキストや翻訳を編集してもこのテーブルしか触らないので、
  snapshot はすべて id 参照のため変更が自動的に反映されます。
- `snapshots` — 分類ビュー 1 つにつき 1 行。それぞれ自分の `layout`
  JSON を持ちます:

  ```json
  {
    "columns": [
      { "id": "col_1", "name": "Yes", "cardIds": ["card_a", "card_b"] },
      { "id": "col_2", "name": "No",  "cardIds": ["card_c"] }
    ],
    "unplacedCardIds": ["card_d"]
  }
  ```

  同じカードが異なる snapshot で異なる column に入っていて構いません。
- `settings` — 小さな key/value バッグ（現在の snapshot id、既定言語、
  seed フラグ）。
- `proposals` — Gemini がある snapshot の配置を読んで生成した
  プロジェクト提案。「カードを引く」ボタンを押すたびに 1 行作られ、
  **生成時点のボードの姿を `layoutSnapshot` に凍結保存**します。
  その後カードを動かしたり列名を変えたりしても、過去の提案は
  作られた当時の文脈ごと読み直せます。

**この設計が自動的に処理してくれるエッジケース**:

- カードを削除 → `cards` から削除され、全 snapshot の layout からも
  id が掃除されます。proposals は**意図的に掃除しません** —— 入力を
  凍結することがあの機能の核心だからです。
- column を削除 → 中のカードは**削除されず**、その snapshot の
  `unplacedCardIds` に戻ります。カードが静かに消えることは絶対に
  ありません。
- snapshot を削除 → カード自体はまったく触られません。現在の
  snapshot は他の残っている snapshot に自動で切り替わります。
  その snapshot に属する proposal は**同じトランザクション内で**
  まとめて削除されます（親を失った proposal は意味がないので）。
- 何かの名前を変える → 1 行だけを更新します。すべての参照は id
  ベースなので、ずれることはありません。
- 新しいカードを追加 → **すべての snapshot の unplaced プール**に
  自動的に現れるので、フレームを切り替えても常に同じアイデアの山
  が見えます。

## 翻訳（Gemini 2.5 Flash）

`src/services/translationService.js` が外部に公開するのは非同期関数
1 つだけ:

```js
translate(text, sourceLang, targetLang) => Promise<string>
```

内部で Google 公式の `@google/genai` SDK を呼び、モデルは
`gemini-2.5-flash` を使います。プロンプトはわざと厳しく書かれていて、
「翻訳本体だけを返せ。引用符・説明・言語ラベル・ローマ字は不要」と
指示してあります。それでもモデルが引用符を付けてきたら、こちら側で
もう一度剥がします。

**発火タイミング**: カードを作成して Create を押したとき、または
編集して Save を押したときに、バックグラウンドで翻訳が走ります。
カードはまず「Translating…」のローディング状態で表示され、翻訳が
完了したら結果に差し替わります。`actions.js` には stale-response
guard があって、返ってきた翻訳が最新のテキストに対応しているかを
確認してから書き込みます。古い遅延翻訳が新しい内容を上書きしてしまう
ことはないので、短時間に何度も編集しても安心です。

**別の翻訳エンジンに差し替えるときは**、`translate()` の中身を書き
換えるだけで OK です。シグネチャを維持する限り、アプリの他の場所は
何も触らなくて済みます。

現在サポートしている言語: `zh-Hant`、`zh-Hans`、`en`、`ja`。言語を
追加したい場合は、同じファイルの `SUPPORTED_LANGUAGES` と
`LANGUAGE_PROMPT_NAMES` を拡張してください。

## プロジェクト提案ガチャ（Project proposals）

ツールバー右上の **💡 Proposals** ボタンを押すと、フルスクリーンの
レポート modal が開きます。左下の「🎲 抽一張新的（新しく引く）」を
押すと、Gemini が**現在の snapshot でカラムに配置されているカードだけ**
を読み（右側の未分類プールは**意図的に読みません**。まだ判断されて
いないカードはシグナルにならないので）、具体的なプロジェクト提案を
出力します:

- **title** — カテゴリ名ではなく、具体的なプロダクト名
- **為什麼是這個（なぜこれか）** — この組み合わせが面白い理由を
  2〜4 文で
- **MVP 起手式（MVP の最初の一手）** — 具体的な最初の 3 ステップ
- **為什麼現在適合做（なぜ今やるのか）** — 1 文ピッチ
- **tags** — 短いタグ 2〜4 個
- **根據當時 board 上的這些卡片（当時のボード状態）** — 生成時点の
  列とカードの凍結スナップショット。後から見返しても当時の文脈が
  完全に復元できる

ボタンを押すたびに新しい proposal が生成され、履歴として蓄積されます。
左側の履歴リストを hover すると × が出て削除できます。**引き直し**
がこの機能の魂なので、毎回言い換えにならないように、
`generateProposal` は同じ snapshot の直近 5 件の完了済み proposal
の title と rationale をプロンプトに混ぜ、「これらの角度は避けろ」と
Gemini に明示します。さらに temperature を 1.1 にして、毎回ちゃんと
異なる方向性が出るようにしています。

実装は `src/services/proposalService.js` にあり、
`translationService.js` と並列ですが独立しています（翻訳の contract
は厳格なので、他の Gemini 呼び出しと混ぜないためです）。出力は
構造化 JSON（`responseMimeType: 'application/json'`）で、モデルが
たまに ```json フェンスを付けたりカンマを打ち間違えたりしても対応
できるフォールバックパーサーを入れてあります。トークン消費は非常に
小さく、1 回あたりプロンプト < 2 KB、レスポンス < 2 KB。
gemini-2.5-flash の料金では実質ゼロなので、安心して連打できます。

## 音声入力（マイクボタン）

カードの作成/編集 modal の中、「Idea」ラベルの横に小さな `🎤 Voice`
ボタンがあります。押すと録音が始まり、textarea の下に認識途中の
テキスト（interim results）がリアルタイムで表示されます。文が
確定するたびに自動で textarea に追記されていきます。もう一度押すと
停止し、録音中はボタンが赤く脈動します。

この機能は Chrome ネイティブの **Web Speech API**
（`webkitSpeechRecognition`）を使っており、**AI トークンは一切
消費しません**。追加のパッケージ依存もありません。動作するのは
Chrome / Chromium Edge のみで、他のブラウザでは自動検出して
ボタン自体を表示しないので落ちる心配はありません。認識言語は modal
で選んだ source language に自動追従します（`zh-Hant` → `zh-TW`、
`ja` → `ja-JP` など）。タイプミスを気にせず口頭でアイデアを出せる
ので、会話しながらカードを増やしていくのにちょうど良いです。

実装は `src/lib/useSpeechRecognition.js` にある薄い hook で、
contract は `{ supported, listening, interim, error, start, stop,
toggle }` と `onFinalChunk` callback のみ。別の STT バックエンドに
差し替えたい場合も、この contract さえ維持すれば中身を入れ替える
だけで済みます。

## UI 小ワザ

- **⌘/Ctrl + Enter**: カード作成 modal で直接送信
- **Esc**: modal を閉じる
- **カラムタイトルをダブルクリック**: その場で改名
- **右上の ☀️/🌙 ボタン**: ダーク/ライト切り替え。既定はダーク
  （目に優しい）。選択は localStorage に保存され、次回起動時も
  記憶されます。ダークモード全体は「深紫の板 + テラコッタオレンジ
  のカード」という warm-on-cool 配色で、カード本文は純白、翻訳は
  78% 白。フォントサイズではなく透明度で階層を作ります。ライト
  モードは中性的な白背景のカードとグレー階調のテキストで、
  オレンジは継承しません。
- **カラム上端のドット握把**: 押さえながら左右にドラッグすると
  列順を並べ替えられます（Yes/No を左右入れ替えるなど）。普段は
  ほぼ見えませんが、カラムに hover すると浮かび上がり、握把自体
  に hover すると完全に点灯します。
- **カラム列の末尾にある破線の「+ Add column」**: クリックで現在の
  snapshot に列を追加できます。ツールバー側のボタンも引き続き
  使えます。
- **右側カードプールの左端**: 一番左の細い線の位置でカーソルが
  左右矢印に変わり、押さえて左右にドラッグするとプールの幅を
  調整できます。幅は localStorage に保存されます。
- **ツールバーの 💡 Proposals ボタン**: proposal reader を開きます。
  「抽一張新的」を押すと現在の配置に基づいて Gemini が
  プロジェクト案を出力。同じ snapshot の履歴は保持され、後から
  見返したり左側のリストから削除したりできます。
- **CardModal の 🎤 Voice ボタン**: カード作成/編集 modal で Idea
  ラベル横の小ボタンを押すと音声入力が始まります。キー入力の
  代わりに声で入れて、もう一度押すと停止。Chrome 系ブラウザ
  でしかボタンは出ません。
- **modal 内のテキスト選択**: modal 内で文字をドラッグ選択する
  とき、マウスが modal の外まで出てしまってから離しても、
  **modal は誤って閉じません**（よくある drag-select 事故は
  すでに対策済みです）。

## プロジェクト構成

```
src/
├── main.jsx                   React エントリ
├── App.jsx                    Seeding gate + <Board> をマウント
├── db/
│   ├── database.js            Dexie schema（v2、proposals を含む）+ settings helper
│   └── actions.js             すべての mutation（cards、snapshots、columns、placement、proposals）
├── services/
│   ├── translationService.js  Gemini 2.5 Flash 翻訳の実装（`@google/genai`）
│   └── proposalService.js     Gemini 2.5 Flash「プロジェクト提案ガチャ」ジェネレータ
├── lib/
│   ├── seedData.js            初回起動時のデフォルトデータ
│   ├── theme.js               localStorage ベースのダーク/ライト切り替え
│   └── useSpeechRecognition.js Chrome Web Speech API の薄い hook
├── components/
│   ├── Board.jsx              トップレベルレイアウト + DndContext + 列の水平並べ替え + ドラッグ handler
│   ├── Toolbar.jsx            Snapshot セレクタ + テーマ切り替え + 💡 Proposals ボタン
│   ├── Column.jsx             並べ替え可能な column（上部握把）+ カードのドロップゾーン
│   ├── Card.jsx               ソート可能なアイデアカード + DragOverlay 用の CardPreview
│   ├── SidePanel.jsx          右側「未分類カードプール」、幅はドラッグで調整可能
│   ├── CardModal.jsx          カード作成/編集 modal（マイクボタン付き）
│   └── ProposalModal.jsx      フルスクリーンの proposal reader（左: 履歴、右: レポート）
└── styles/
    └── app.css                すべてのスタイル。テーマは CSS 変数で、:root がダーク
```

## 技術スタック

React 18 + Vite · Dexie (IndexedDB) + `dexie-react-hooks` で
リアクティブ読み取り · `@dnd-kit/core` + `@dnd-kit/sortable` で
マルチコンテナドラッグ · `@google/genai` で Gemini 2.5 Flash を
**翻訳**と**提案生成**の両方に使用 · Chrome ネイティブ Web Speech
API で音声入力（ゼロトークン・ゼロ依存） · 素の CSS + 変数
（テーマ切り替えが容易、Tailwind のノイズ不要）。

## リセットしたいとき

全部消してもう一度 seed したい場合は、ブラウザの DevTools →
Application → IndexedDB → `IdeaSortingBoard` データベースを削除 →
ページを再読み込み。

## 次の Claude セッションへ

Claude Code CLI で開いたセッションの場合は、まず `CLAUDE.md` を
読んでください。データモデルの invariant、触ってはいけない箇所、
次にハマりそうな落とし穴がまとめてあります。
