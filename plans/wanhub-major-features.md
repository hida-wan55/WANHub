# WANHub 大型機能追加プラン

**作成日:** 2026-06-26  
**対象リポジトリ:** E:\Works\AI\Claude\backlog-clone\  
**デプロイ方法:** deploy.bat（vercel --prod）  
**技術スタック:** HTML + Vanilla JS + Supabase (PostgreSQL) + Vercel  

---

## 依存グラフ

```
Step 1 (DB)
  ├── Step 2 (メンター)
  │     └── Step 3 (親子課題)  ← Step 2 と同ファイル・直列必須
  ├── Step 4 (ボード)
  │     └── Step 6 (ガント)    ← project.html ナビを Step 4 で追加するため
  └── Step 5 (Wiki)             ← 独立・Step 4 と並列可能
```

**並列実行可能:** Step 4 と Step 5（ファイル競合なし）  
**直列必須:** Step 2 → Step 3、Step 4 → Step 6

---

## Step 1: DB マイグレーション【必須・最初に実行】

### コンテキスト
WANHub は Supabase (PostgreSQL) を使用。テーブル変更は Supabase ダッシュボードの SQL Editor から実行する。以降のすべての Step がこの Step に依存する。

### タスク
Supabase ダッシュボード（https://supabase.com/dashboard → プロジェクト選択 → SQL Editor）で以下を実行：

```sql
-- 1. mentor_id（副担当）を issues テーブルに追加
ALTER TABLE issues
  ADD COLUMN IF NOT EXISTS mentor_id uuid REFERENCES profiles(id) ON DELETE SET NULL;

-- 2. parent_id（親課題）を issues テーブルに追加（自己参照）
ALTER TABLE issues
  ADD COLUMN IF NOT EXISTS parent_id uuid REFERENCES issues(id) ON DELETE SET NULL;

-- 3. wiki_pages テーブルを新規作成
CREATE TABLE IF NOT EXISTS wiki_pages (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title       text NOT NULL,
  content     text NOT NULL DEFAULT '',
  created_by  uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  uuid REFERENCES profiles(id) ON DELETE SET NULL
);

-- 4. wiki_pages の RLS を有効化（既存テーブルと同じポリシー）
ALTER TABLE wiki_pages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read wiki_pages"
  ON wiki_pages FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can insert wiki_pages"
  ON wiki_pages FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Authenticated users can update wiki_pages"
  ON wiki_pages FOR UPDATE TO authenticated USING (true);

CREATE POLICY "Authenticated users can delete wiki_pages"
  ON wiki_pages FOR DELETE TO authenticated USING (true);
```

### 確認
- Supabase ダッシュボードの Table Editor で issues に `mentor_id`, `parent_id` が表示される
- `wiki_pages` テーブルが存在する
- RLS が有効になっている

### 完了基準
- SQL 実行エラーなし
- 3カラム/1テーブルが追加されている

---

## Step 2: メンター（副担当）UI

### コンテキスト
- ローカルパス: `E:\Works\AI\Claude\backlog-clone\`
- 変更ファイル: `issue.html`, `js/issue.js`, `project.html`, `js/project.js`, `css/style.css`
- DB: `issues.mentor_id` (uuid, nullable, FK → profiles) は Step 1 で追加済み
- 既存の担当者（assignee）と同じ UI パターンで副担当を追加する
- `js/auth.js` に共通関数（escapeHtml, avatarHtml, statusBadge 等）がある

### タスク

**issue.html**
- メタパネルに「副担当」select を追加（担当者の直下）
- `<select id="meta-mentor" class="form-select">` として追加

**js/issue.js**
- `loadProfiles()` で `#meta-mentor` select にも profiles を追加
- `loadIssue()` で `mentor_id` を select に反映
- `setupMetaSave()` で `mentor_id` を保存に含める
- `loadIssue()` の select クエリに mentor フィールドを追加（`mentor:profiles!mentor_id(id,name,avatar_url)`）
- メタパネルに副担当のアバター表示を追加

**project.html**
- 課題テーブルに「副担当」列を追加（担当者列の右）
- 課題作成モーダルに副担当 select を追加

**js/project.js**
- `loadIssues()` の select クエリに `mentor:profiles!mentor_id(id,name,avatar_url)` を追加
- `renderIssues()` で副担当列を表示
- `setupCreateIssue()` で mentor_id を保存

**css/style.css**
- 特別な追加なし（既存の `.user-avatar` を流用）

### 完了基準
- 課題詳細で副担当を設定・保存できる
- 課題一覧で副担当が表示される
- 副担当なしの場合は「-」表示

---

## Step 3: 親子課題（サブタスク）

### コンテキスト
- 変更ファイル: `issue.html`, `js/issue.js`（Step 2 と同じファイル → Step 2 完了後に実施）
- DB: `issues.parent_id` (uuid, nullable, self-reference) は Step 1 で追加済み
- 親課題は1つまで。サブタスクは複数可。

### タスク

**issue.html**
- メタパネルに「親課題」行を追加
  - テキスト表示（クリックで変更モーダル）または select
- 課題詳細本文エリアの下に「サブタスク」セクションを追加
  - サブタスク一覧（タイトル + ステータスバッジ + リンク）
  - 「+ サブタスクを追加」ボタン → 簡易入力エリア表示

**js/issue.js**
- `loadIssue()` の select に `parent:issues!parent_id(id,title)` を追加
- 親課題をメタパネルに表示（クリックで issue.html?id=xxx に遷移）
- `loadSubIssues()` 関数を追加
  - `supabaseClient.from('issues').select('id,title,status').eq('parent_id', issueId)` でサブタスク取得
  - ステータスバッジ付きのリスト表示
- `setupCreateSubIssue()` 関数を追加
  - タイトル入力 + 保存で `{title, project_id, parent_id: issueId, ...}` をインサート
  - 完了後 `loadSubIssues()` を再実行
- 「親課題を設定」機能
  - テキスト入力で課題を検索 → 選択 → `parent_id` を保存

**css/style.css**
- `.subtask-list` スタイル追加（左インデント + 細い区切り線）
- `.subtask-item` スタイル追加

### 完了基準
- 課題詳細で親課題を設定・表示できる
- サブタスクを作成・一覧表示できる
- サブタスクのリンクをクリックすると該当課題に遷移する

---

## Step 4: カンバンボード

### コンテキスト
- 新規ファイル: `board.html`, `js/board.js`
- 変更ファイル: `project.html`（ナビゲーションにタブ追加）, `css/style.css`
- Backlog のスクリーンショット参照: ステータス別カラム、課題カードをドラッグ＆ドロップ
- ドラッグ＆ドロップは HTML5 Drag API（外部ライブラリなし）
- ステータスは `statuses` テーブルから動的に取得（既存の `loadStatuses()` を使用）
- URL: `/board.html?id={project_id}`

### タスク

**project.html**
- ヘッダー付近に「リスト | ボード | ガント」タブ UI を追加
  - リスト: 現在のページ
  - ボード: `/board.html?id={project_id}` へのリンク
  - ガント: `/gantt.html?id={project_id}` へのリンク（Step 6 で実装）

**board.html（新規）**
- `project.html` と同じサイドバー・ヘッダー構造
- メインエリアにカンバンカラムを横並びで配置
- フィルタバー（担当者・優先度）

**js/board.js（新規）**
- `init()`: 認証 → プロジェクト情報取得 → ステータス取得 → 課題取得 → ボード描画
- `renderBoard(issues)`: ステータスごとにカラムを生成
  - 各カラム: ステータス名 + 課題数バッジ + カード一覧
  - カード: タイトル・優先度バッジ・担当者アバター・期限日
- ドラッグ＆ドロップ
  - `dragstart` でカード ID を `dataTransfer` にセット
  - `dragover` / `drop` でカラムがハイライト → ドロップ時に status を UPDATE
  - DROP 後 `renderBoard()` を再実行

**css/style.css**
- `.board-container`: 横スクロール可能な flex コンテナ
- `.board-column`: 固定幅（280px）、縦スクロール可能
- `.board-column-header`: ステータス色のドット + タイトル + 件数
- `.board-card`: 白カード、hover で影
- `.board-card.drag-over`: ドラッグ中のハイライト
- `.view-tabs`: リスト/ボード/ガント切り替えタブ

### 完了基準
- ボードページが開ける（/board.html?id=xxx）
- ステータス別カラムに課題カードが表示される
- カードをドラッグ＆ドロップでステータス変更できる
- 変更が DB に保存される

---

## Step 5: Wiki（プロジェクトドキュメント）

### コンテキスト
- 新規ファイル: `wiki.html`, `js/wiki.js`
- 変更ファイル: `dashboard.html`, `project.html`, `board.html`(Step4後), `issue.html`, `admin.html`（サイドバーにリンク追加）, `css/style.css`
- DB: `wiki_pages` テーブルは Step 1 で作成済み
- URL: `/wiki.html?id={project_id}`
- 書式: プレーンテキスト（Markdown は将来対応・スコープ外）
- Step 4 と並列実行可能

### タスク

**wiki.html（新規）**
- 左パネル: ページ一覧（プロジェクト内の wiki ページ）
- 右パネル: ページ本文表示 + 編集ボタン
- 編集モード: タイトル入力 + textarea + 保存ボタン
- 新規作成ボタン

**js/wiki.js（新規）**
- `init()`: 認証 → プロジェクト情報取得 → ページ一覧取得
- `loadPages()`: `wiki_pages.select('*').eq('project_id', projectId)` で一覧取得・左パネル描画
- `loadPage(pageId)`: 選択ページの本文を右パネルに表示
- `setupEditor()`: 新規作成・編集・保存・削除
  - 保存時: INSERT or UPDATE（upsert 不可のため分岐）
  - 削除時: 確認ダイアログ → DELETE

**各 HTML ファイルのサイドバー**
- `project.html`, `issue.html` のサイドバーに Wiki リンクを追加
  - `<a href="/wiki.html?id={project_id}" class="sidebar-link"><i class="bi bi-journal-text"></i> Wiki</a>`
- `dashboard.html` ではプロジェクト未選択のためリンクなし（または無効化）

**css/style.css**
- `.wiki-layout`: 左パネル + 右パネルの2カラムレイアウト
- `.wiki-sidebar`: ページ一覧パネル（幅 220px）
- `.wiki-page-item`: ページリストアイテム、active 時ハイライト
- `.wiki-content`: 本文表示エリア（`white-space: pre-wrap`）
- `.wiki-editor`: 編集フォーム

### 完了基準
- Wiki ページを作成・表示・編集・削除できる
- プロジェクト別にページが分かれている
- サイドバーから Wiki に遷移できる

---

## Step 6: ガントチャート

### コンテキスト
- 新規ファイル: `gantt.html`, `js/gantt.js`
- 変更ファイル: `project.html`（Step 4 でタブ追加済み）, `css/style.css`
- DB: `issues.start_date`, `issues.due_date` は既存カラム（Step 1 不要）
- 外部ライブラリなし・純粋 CSS + JS で実装
- 表示期間: 直近3ヶ月（前後スクロール可）
- URL: `/gantt.html?id={project_id}`
- **Step 4 完了後に実施**（project.html のタブ UI を Step 4 で追加するため）

### タスク

**gantt.html（新規）**
- `project.html` と同じサイドバー・ヘッダー
- ヘッダー: 「リスト | ボード | ガント」タブ（ガントをアクティブ）
- 左列: 課題タイトル + 担当者
- 右エリア: 日付ヘッダー + バー表示エリア（横スクロール）

**js/gantt.js（新規）**
- `init()`: 認証 → プロジェクト取得 → 課題取得 → ガント描画
- `loadIssues()`: `start_date`, `due_date`, `assignee`, `status` を含めて取得
  - `start_date` または `due_date` が null の課題は一覧下部に別表示
- `renderGantt(issues)`:
  - 表示期間: 今日を含む前後6週間（デフォルト）
  - 日付ヘッダー: 月ラベル + 日ラベル（週単位で区切り）
  - 各行: タイトル列 + バー（`start_date` ～ `due_date` の幅を % または px で計算）
  - バーの色: ステータスに応じた色（`window.statusList` の color を使用）
  - 今日ライン: 赤い縦線
- ナビゲーション:「← 前」「今日」「次 →」ボタンで表示期間をシフト

**css/style.css**
- `.gantt-container`: 左列 + 右エリアの flex レイアウト
- `.gantt-left`: タイトル列（固定幅 240px、sticky）
- `.gantt-right`: 日付エリア（横スクロール）
- `.gantt-bar`: バー本体（border-radius 4px、高さ 20px）
- `.gantt-today-line`: 今日の縦線（赤・z-index 高め）
- `.gantt-row`: 1行（左列 + バーセル）、hover でハイライト
- `.gantt-header-month`: 月ラベル
- `.gantt-header-day`: 日ラベル（週末は薄い背景）

### 完了基準
- ガントチャートページが開ける（/gantt.html?id=xxx）
- start_date/due_date がある課題がバーで表示される
- 今日ラインが表示される
- 前後ナビゲーションで期間をスクロールできる

---

## 実装順序サマリー

| Step | 内容 | 依存 | 並列可否 | 難度 |
|------|------|------|----------|------|
| 1 | DB マイグレーション（SQL実行） | なし | — | 低 |
| 2 | メンター（副担当）UI | Step 1 | — | 低 |
| 3 | 親子課題・サブタスク | Step 2 | — | 中 |
| 4 | カンバンボード | Step 1 | Step 5 と並列可 | 中 |
| 5 | Wiki | Step 1 | Step 4 と並列可 | 中 |
| 6 | ガントチャート | Step 4 | — | 高 |

---

## デプロイ

各 Step 完了後: `deploy.bat` をダブルクリック（`vercel --prod`）

---

## ロールバック

- DB カラム追加: `ALTER TABLE issues DROP COLUMN mentor_id;` 等で削除可能
- wiki_pages: `DROP TABLE wiki_pages;` で削除
- 新規 HTML/JS ファイル: 削除するだけ（既存ページに影響なし）
- project.html のタブ追加: 該当 HTML を元に戻す
