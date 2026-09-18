from routers.housekeeping import _sequence_rooms


def _room(room_number, floor, building):
    return {"room_id": f"room-{room_number}", "room_number": room_number, "floor": floor, "building": building}


def test_single_room_gets_sequence_one():
    rooms = [_room("101", 1, "A")]
    result = _sequence_rooms(rooms)
    assert result[0]["sequence"] == 1


def test_empty_list_returns_empty():
    assert _sequence_rooms([]) == []


def test_same_floor_rooms_ordered_by_room_number_proximity():
    # Shuffled order in; walking order out should not jump around.
    rooms = [_room("108", 1, "A"), _room("101", 1, "A"), _room("104", 1, "A")]
    result = _sequence_rooms(rooms)
    numbers = [r["room_number"] for r in result]
    assert numbers == ["101", "104", "108"]
    assert [r["sequence"] for r in result] == [1, 2, 3]


def test_prefers_finishing_a_floor_before_switching():
    # Two floor-1 rooms and one floor-3 room: the floor-3 room should sit at
    # one end of the route, never sandwiched between the floor-1 rooms,
    # since a floor switch is the expensive move.
    rooms = [_room("101", 1, "A"), _room("301", 3, "A"), _room("102", 1, "A")]
    result = _sequence_rooms(rooms)
    floors = [r["floor"] for r in result]
    assert floors.index(3) in (0, 2)


def test_building_switch_is_more_expensive_than_floor_switch():
    # Housekeeper has 2 rooms in building A (different floors) and 1 in
    # building B. The building-B room should end up at an end of the route,
    # not splitting the two A rooms (a building switch costs more than a
    # floor switch).
    rooms = [_room("101", 1, "A"), _room("201", 2, "A"), _room("101", 1, "B")]
    result = _sequence_rooms(rooms)
    buildings = [r["building"] for r in result]
    assert buildings.index("B") in (0, 2)


def test_sequence_numbers_are_contiguous_from_one():
    rooms = [_room(str(100 + i), 1, "A") for i in range(7)]
    result = _sequence_rooms(rooms)
    assert [r["sequence"] for r in result] == list(range(1, 8))
