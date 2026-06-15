"""
One-time script to store the hotel's spatial layout in the tenants table.
Run: python apps/api/scripts/seed_hotel_layout.py

Requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in environment.
"""
import os
import sys
import json

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from core.database import supabase

# ─── Layout derived from property floor map ───────────────────────────────────
# Orientation: lobby faces NORTH. Building A = west (left). Building B = east (right).
# Pool + Spa + Sport Court occupy the central courtyard between the buildings.
# Lobby building (Front Desk, Market, Hearth Room, Exercise, Meeting Room) is at the south.

LAYOUT = {
    "orientation": "Lobby faces north. Building A is west (left), Building B is east (right). No internal connection between buildings — staff cross through the outdoor courtyard.",

    "common_areas": {
        "pool": "central courtyard between buildings",
        "spa": "adjacent to pool, central courtyard",
        "sport_court": "north side of courtyard near Building B entry",
        "lobby_building": "south — contains Front Desk, Market, Hearth Room, Exercise Room, Business Center, Meeting Room"
    },

    "buildings": {
        "A": {
            "name": "Building A",
            "position": "west — left when facing north into lobby",
            "shape": "straight_double_corridor",
            "notes": (
                "Two columns of rooms facing each other across a central corridor. "
                "Odd-numbered rooms on the west column, even on the east. "
                "South end is the lobby entry (101/102); north end is 115/116 near Stair 2."
            ),
            "columns": {
                "west_odd":  ["101","103","105","107","109","111","113","115"],
                "east_even": ["102","104","106","108","110","112","114","116"]
            },
            "floors": {
                "1": {
                    "rooms": ["101","102","103","104","105","106","107","108",
                              "109","110","111","112","113","114","115","116"],
                    "clusters": [
                        {"name": "A1-South", "rooms": ["101","102","103","104","105","106","107","108"],
                         "note": "south half, lobby-side entry"},
                        {"name": "A1-North", "rooms": ["109","110","111","112","113","114","115","116"],
                         "note": "north half toward Stair 2"}
                    ],
                    "amenities": {
                        "elevator": "corridor between rooms 108 (east) and 110 (east) — center of building",
                        "stair_1": "Stair 1 at rooms 101/102 (south/lobby end)",
                        "stair_2": "Stair 2 near rooms 115/116 (north end)"
                    }
                },
                "2": {
                    "rooms": ["201","202","203","204","205","206","207","208",
                              "209","210","211","212","213","214","215","216"],
                    "clusters": [
                        {"name": "A2-South", "rooms": ["201","202","203","204","205","206","207","208"]},
                        {"name": "A2-North", "rooms": ["209","210","211","212","213","214","215","216"]}
                    ],
                    "amenities": {
                        "elevator": "between rooms 208 and 210",
                        "guest_laundry": "between rooms 207 and 209 (west side of elevator, marked *)"
                    }
                },
                "3": {
                    "rooms": ["301","302","303","304","305","306","307","308",
                              "309","310","311","312","313","314","315","316"],
                    "clusters": [
                        {"name": "A3-South", "rooms": ["301","302","303","304","305","306","307","308"]},
                        {"name": "A3-North", "rooms": ["309","310","311","312","313","314","315","316"]}
                    ],
                    "amenities": {
                        "elevator": "between rooms 308 and 310"
                    }
                }
            }
        },

        "B": {
            "name": "Building B",
            "position": "east — right when facing north into lobby",
            "shape": "L_shape",
            "notes": (
                "L-shaped building: a horizontal north arm (rooms 117–127, two rows) that turns "
                "at the northeast corner (123/124/125/127) into a vertical east arm running south "
                "(rooms 128–139, two columns). Entry via Stair 3 near 117/118. South end at 138/139 near Stair 4."
            ),
            "sections": {
                "north_arm": {
                    "description": "Horizontal section at the top of the L. Two rows facing each other.",
                    "north_row": ["117","119","121","123","125"],
                    "south_row": ["118","120","122","124","127"],
                    "corner_rooms": ["123","124","125","127"],
                    "stair": "Stair 3 near rooms 117/118 (west entry of north arm)"
                },
                "east_arm": {
                    "description": "Vertical section running south from the L-corner.",
                    "west_column": ["128","130","132","134","136","138"],
                    "east_column": ["129","131","133","135","137","139"],
                    "stair": "Stair 4 near rooms 138/139 (south end)"
                }
            },
            "floors": {
                "1": {
                    "rooms": ["117","118","119","120","121","122","123","124","125","127",
                              "128","129","130","131","132","133","134","135","136","137","138","139"],
                    "clusters": [
                        {"name": "B1-NorthArm", "rooms": ["117","118","119","120","121","122","123","124","125","127"],
                         "note": "horizontal top of L, entry from Stair 3"},
                        {"name": "B1-EastArm-Upper", "rooms": ["128","129","130","131"],
                         "note": "upper east arm, near corner"},
                        {"name": "B1-EastArm-Lower", "rooms": ["132","133","134","135","136","137","138","139"],
                         "note": "lower east arm toward Stair 4"}
                    ],
                    "amenities": {
                        "elevator": "between rooms 131 (east col) and 133 (east col) — mid east arm, marked *",
                        "stair_north": "Stair 3 near 117/118",
                        "stair_south": "Stair 4 near 138/139"
                    }
                },
                "2": {
                    "rooms": ["217","218","219","220","221","222","223","224","225","227",
                              "228","229","230","231","232","233","234","235","236","237","238","239"],
                    "clusters": [
                        {"name": "B2-NorthArm", "rooms": ["217","218","219","220","221","222","223","224","225","227"]},
                        {"name": "B2-EastArm-Upper", "rooms": ["228","229","230","231"]},
                        {"name": "B2-EastArm-Lower", "rooms": ["232","233","234","235","236","237","238","239"]}
                    ],
                    "amenities": {
                        "elevator": "between rooms 231 and 233",
                        "guest_laundry": "between rooms 230 and 232 (west column, marked *)"
                    }
                },
                "3": {
                    "rooms": ["317","318","319","320","321","322","323","324","325","327",
                              "328","329","330","331","332","333","334","335","336","337","338","339"],
                    "clusters": [
                        {"name": "B3-NorthArm", "rooms": ["317","318","319","320","321","322","323","324","325","327"]},
                        {"name": "B3-EastArm-Upper", "rooms": ["328","329","330","331"]},
                        {"name": "B3-EastArm-Lower", "rooms": ["332","333","334","335","336","337","338","339"]}
                    ],
                    "amenities": {
                        "elevator": "between rooms 331 and 333"
                    }
                }
            }
        }
    },

    "routing_rules": [
        "Buildings A and B are physically separate — staff must cross the outdoor courtyard (pool area) to switch buildings. Assign housekeepers to one building per shift.",
        "Building A: straight corridor, south (lobby) to north (Stair 2). Elevator at center between rooms 108/110. Work south-to-north or north-to-south in one pass.",
        "Building A: guest laundry on floor 2 between rooms 207/209 (west side near elevator). Linen run: floor 2 elevator, pull linen, distribute up/down.",
        "Building B north arm: horizontal section at top of L (rooms 117–127). Entry from Stair 3 at west end. Corner at rooms 123/124/125/127.",
        "Building B east arm: vertical section (rooms 128–139). Elevator between 131/133. Work the arm top-to-bottom or bottom-to-top to avoid doubling back.",
        "Building B: guest laundry on floor 2 between rooms 230/232 (west column near elevator). Accessible from elevator level.",
        "For task delegation: prefer the housekeeper already assigned to the same building and floor as the task room. If task is in B east arm, check who is working 128–139 range.",
        "Room number ranges — A floor 1: 101–116, floor 2: 201–216, floor 3: 301–316. B floor 1: 117–139 (note: no room 126), floor 2: 217–239, floor 3: 317–339."
    ]
}


def main():
    hotel_id = os.environ.get("HOTEL_ID")
    if not hotel_id:
        result = supabase.table("tenants").select("id, name").limit(5).execute()
        if not result.data:
            print("ERROR: No tenants found. Set HOTEL_ID env var.")
            sys.exit(1)
        if len(result.data) > 1:
            print("Multiple tenants found. Set HOTEL_ID env var to target one:")
            for row in result.data:
                print(f"  {row['id']}  {row['name']}")
            sys.exit(1)
        hotel_id = result.data[0]["id"]
        print(f"Targeting hotel: {result.data[0]['name']} ({hotel_id})")

    update = supabase.table("tenants").update({"layout": LAYOUT}).eq("id", hotel_id).execute()
    if update.data:
        print(f"Layout saved for hotel {hotel_id}")
    else:
        print("ERROR: Update returned no data.")
        sys.exit(1)


if __name__ == "__main__":
    main()
