-- WANHub DB マイグレーション
-- Supabase Dashboard > SQL Editor で実行してください

-- 1. projectsにPJコードを追加
ALTER TABLE projects ADD COLUMN IF NOT EXISTS code VARCHAR(20);

-- 2. issuesに課題番号・工数を追加
ALTER TABLE issues ADD COLUMN IF NOT EXISTS issue_number INTEGER;
ALTER TABLE issues ADD COLUMN IF NOT EXISTS planned_hours DECIMAL(6,1);
ALTER TABLE issues ADD COLUMN IF NOT EXISTS actual_hours DECIMAL(6,1);

-- 3. PJメンバーテーブルを作成（既存がある場合は削除して再作成）
DROP TABLE IF EXISTS project_members;
CREATE TABLE project_members (
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  PRIMARY KEY (project_id, user_id)
);
-- 他のテーブルと同様にRLSを無効化
ALTER TABLE project_members DISABLE ROW LEVEL SECURITY;

-- 4. コメントに変更ログカラムを追加
ALTER TABLE comments ADD COLUMN IF NOT EXISTS is_activity BOOLEAN DEFAULT FALSE;
ALTER TABLE comments ADD COLUMN IF NOT EXISTS activity_data JSONB;

-- 5. コメント確認テーブルを作成
CREATE TABLE IF NOT EXISTS comment_confirmations (
  comment_id   UUID NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  confirmed_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (comment_id, user_id)
);
ALTER TABLE comment_confirmations DISABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, DELETE ON comment_confirmations TO anon, authenticated;
