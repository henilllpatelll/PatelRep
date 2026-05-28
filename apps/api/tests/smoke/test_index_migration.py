from pathlib import Path


def test_input_validation_index_migration_covers_hot_list_paths():
    migration = (
        Path(__file__).parents[4]
        / "supabase"
        / "migrations"
        / "043_input_validation_and_pooling_indexes.sql"
    )

    sql = migration.read_text(encoding="utf-8")

    assert "idx_tasks_tenant_created_desc" in sql
    assert "idx_lost_found_tenant_status_created_desc" in sql
    assert "idx_inspections_tenant_completed_desc" in sql
    assert "idx_staff_invitations_tenant_pending_created_desc" in sql
    assert "pg_trgm" in sql
