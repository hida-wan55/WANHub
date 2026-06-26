// ========================================
// Supabase接続設定
// SupabaseダッシュボードのProject Settings > API から取得してください
// ========================================

const SUPABASE_URL = 'https://nxtrhdxpfloxyjaddroi.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im54dHJoZHhwZmxveHlqYWRkcm9pIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI0NDYxMjcsImV4cCI6MjA5ODAyMjEyN30.1S-Am73kiKpnj0d_x_EydAD2aFc0C3v0GoUh6sFY2AA';

const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
