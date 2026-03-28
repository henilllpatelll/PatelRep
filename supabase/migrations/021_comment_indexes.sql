-- Migration 021: Indexes on comment foreign keys
-- Prevents full table scans when fetching comments for a specific task or work order.

CREATE INDEX IF NOT EXISTS idx_task_comments_task_id
    ON task_comments (task_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_work_order_comments_wo_id
    ON work_order_comments (work_order_id, created_at DESC);
