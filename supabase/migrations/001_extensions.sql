-- =============================================================================
-- Migration 001: PostgreSQL Extensions
-- Enable all required extensions for PatelRep
-- =============================================================================

-- UUID generation (gen_random_uuid() is built-in in PG 14+, but uuid-ossp
-- provides uuid_generate_v4() for compatibility)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- pgvector: vector similarity search for SOP RAG (retrieval-augmented generation)
CREATE EXTENSION IF NOT EXISTS vector;

-- pg_cron: schedule recurring jobs (PM generation, credit rollups, sync jobs)
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- pgcrypto: cryptographic functions (gen_salt, crypt) for encrypting credentials
CREATE EXTENSION IF NOT EXISTS pgcrypto;
