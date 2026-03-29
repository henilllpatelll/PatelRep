-- Migration 023: Add ON DELETE CASCADE to child-record FK constraints
-- Ensures task_comments, work_order_comments, work_order_photos are
-- automatically cleaned up when their parent records are deleted.

ALTER TABLE task_comments
  DROP CONSTRAINT IF EXISTS task_comments_task_id_fkey,
  ADD CONSTRAINT task_comments_task_id_fkey
    FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE;

ALTER TABLE work_order_comments
  DROP CONSTRAINT IF EXISTS work_order_comments_work_order_id_fkey,
  ADD CONSTRAINT work_order_comments_work_order_id_fkey
    FOREIGN KEY (work_order_id) REFERENCES work_orders(id) ON DELETE CASCADE;

ALTER TABLE work_order_photos
  DROP CONSTRAINT IF EXISTS work_order_photos_work_order_id_fkey,
  ADD CONSTRAINT work_order_photos_work_order_id_fkey
    FOREIGN KEY (work_order_id) REFERENCES work_orders(id) ON DELETE CASCADE;
