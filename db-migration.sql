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
