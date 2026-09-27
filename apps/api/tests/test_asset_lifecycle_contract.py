from models.requests import CreateAssetRequest, UpdateAssetRequest


def test_asset_lifecycle_fields_are_accepted_for_create_and_edit():
    category_id = "11111111-1111-4111-8111-111111111111"
    room_id = "22222222-2222-4222-8222-222222222222"
    create = CreateAssetRequest(
        name="PTAC · Room 412",
        category_id=category_id,
        room_id=room_id,
        installation_date="2018-04-01",
        purchase_date="2018-03-01",
        warranty_expires="2028-03-14",
        asset_tag="PTAC-0412",
        notes="North wall unit",
    )
    edit = UpdateAssetRequest(
        category_id=category_id,
        room_id=room_id,
        installation_date="2018-04-01",
        purchase_date="2018-03-01",
        warranty_expires="2028-03-14",
        expected_lifespan_years=10,
        replacement_cost=1250,
    )

    assert create.warranty_expires.isoformat() == "2028-03-14"
    assert str(create.room_id) == room_id
    assert edit.replacement_cost == 1250
