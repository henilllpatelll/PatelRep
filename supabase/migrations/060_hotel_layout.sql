-- 060_hotel_layout.sql
-- Stores spatial layout context so AI can reason about building proximity,
-- room clusters, and optimal routing for assignment suggestions and task delegation.
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS layout jsonb;
