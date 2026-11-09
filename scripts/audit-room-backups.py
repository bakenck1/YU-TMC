"""Read selected tables from backup archives as text; never connect/restore to PostgreSQL."""
import hashlib
import json
import os
import re
import subprocess
import sys
import unicodedata
from datetime import datetime, timezone
from pathlib import Path

TABLES = ("buildings", "rooms", "items", "audit_records", "item_inventory_number_history", "responsibility_periods")
TARGET_NUMBERS = {"2416/0465", "1350/17166"}
OLD_PROJECTOR = "af6e6c8f-a6e2-4ee0-b042-28b73dea4a69"
COPY_START = re.compile(r'^COPY (?:"?yu_inventory"?\.)"?([a-z_]+)"? \((.+)\) FROM stdin;$')
ESCAPE = re.compile(r'\\([0-7]{1,3}|x[0-9a-fA-F]{1,2}|.)')


def unescape(value):
    if value == r"\N":
        return None
    def replace(match):
        token = match.group(1)
        if token[0] in "01234567":
            return chr(int(token, 8))
        if token.startswith("x") and len(token) > 1:
            return chr(int(token[1:], 16))
        return {"b": "\b", "f": "\f", "n": "\n", "r": "\r", "t": "\t", "v": "\v", "\\": "\\"}.get(token, token)
    return ESCAPE.sub(replace, value)


def parse_copy(sql):
    result = {}
    active = None
    columns = []
    for line in sql.splitlines():
        if active is None:
            match = COPY_START.match(line)
            if match:
                active = match.group(1)
                columns = [column.strip().strip('"') for column in match.group(2).split(",")]
                result.setdefault(active, [])
            continue
        if line == r"\.":
            active = None
            continue
        values = line.split("\t")
        if len(values) != len(columns):
            raise ValueError("copy_column_count_mismatch")
        row = dict(zip(columns, map(unescape, values)))
        for key in ("before_values", "after_values", "metadata"):
            if row.get(key) is not None:
                row[key] = json.loads(row[key])
        result[active].append(row)
    if active is not None:
        raise ValueError("truncated_copy_data")
    return result


def room_name(value):
    return re.sub(r"[\s_-]", "", unicodedata.normalize("NFKC", str(value or "")).upper()).replace("В", "B")


def room_mention(value):
    return bool(re.search(r"(?<![\w])(?:B|В|D)[\s_-]*201(?!\d)", str(value or ""), re.I))


def evidence(tables):
    rooms = tables.get("rooms", [])
    audits = tables.get("audit_records", [])
    room_ids = {r["id"] for r in rooms if room_name(r.get("designation")) in {"B201", "D201"}}
    for event in audits:
        if event.get("subject_kind") != "room":
            continue
        if any(room_name((event.get(stage) or {}).get("designation")) in {"B201", "D201"} for stage in ("before_values", "after_values")):
            room_ids.add(event["subject_id"])
    items = tables.get("items", [])
    item_ids = {i["id"] for i in items if i.get("room_id") in room_ids or i.get("id") == OLD_PROJECTOR
                or i.get("inventory_number") in TARGET_NUMBERS or "220643" in (i.get("inventory_number") or "").upper()}
    for event in audits:
        if event.get("subject_kind") != "item":
            continue
        if any((event.get(stage) or {}).get("roomId") in room_ids
               or room_mention((event.get(stage) or {}).get("roomLabel"))
               or (event.get(stage) or {}).get("inventoryNumber") in TARGET_NUMBERS
               for stage in ("before_values", "after_values")):
            item_ids.add(event["subject_id"])
    relevant = []
    related_rooms = set(room_ids)
    for event in audits:
        if event.get("subject_id") in room_ids | item_ids or any(identifier in json.dumps(event, ensure_ascii=False) for identifier in room_ids | item_ids):
            relevant.append(event)
            for stage in ("before_values", "after_values"):
                room_id = (event.get(stage) or {}).get("roomId")
                if room_id:
                    related_rooms.add(room_id)
    room_rows = [r for r in rooms if r["id"] in related_rooms]
    building_ids = {r["building_id"] for r in room_rows}
    keep_item_columns = {"id", "name", "description", "room_id", "inventory_number", "inventory_number_kind", "item_type", "item_section", "brand", "model", "quantity", "status", "version", "created_at", "updated_at", "archived_at", "created_by", "updated_by"}
    return {
        "counts": {table: len(tables.get(table, [])) for table in TABLES},
        "tablesExtracted": sorted(tables),
        "targetRoomIds": sorted(room_ids),
        "targetItemIds": sorted(item_ids),
        "buildings": [b for b in tables.get("buildings", []) if b["id"] in building_ids],
        "rooms": room_rows,
        "items": [{key: value for key, value in i.items() if key in keep_item_columns} for i in items if i["id"] in item_ids],
        "audit": relevant,
        "numberHistory": [h for h in tables.get("item_inventory_number_history", []) if h["item_id"] in item_ids],
        "responsibility": [h for h in tables.get("responsibility_periods", []) if h["item_id"] in item_ids],
        "photos": tables.get("photos", []),
    }


def self_test():
    data = 'COPY yu_inventory.items (id, name, inventory_number, description) FROM stdin;\n1\tШкаф\\tB201\t001/000123\t\\N\n\\.\n'
    parsed = parse_copy(data)["items"][0]
    assert parsed == {"id": "1", "name": "Шкаф\tB201", "inventory_number": "001/000123", "description": None}
    nested = json.dumps({"name": "Тест\\слэш", "description": "строка\nвторая"}, ensure_ascii=False)
    escaped = nested.replace("\\", "\\\\").replace("\t", "\\t").replace("\n", "\\n")
    audit = parse_copy('COPY "yu_inventory"."audit_records" (id, after_values) FROM stdin;\nx\t' + escaped + '\n\\.\n')
    assert audit["audit_records"][0]["after_values"] == json.loads(nested)
    assert room_name("В 201") == "B201" and room_name("B-201") == "B201"
    assert not room_mention("B2010") and room_mention("The Main Campus, B201")
    tables = {"rooms": [{"id": "r1", "building_id": "b", "designation": "B201"}],
              "items": [{"id": "i1", "room_id": "r1", "inventory_number": "001/000123"}],
              "audit_records": [{"subject_kind": "item", "subject_id": "deleted", "after_values": {"roomId": "r1"}}]}
    found = evidence(tables)
    assert found["targetItemIds"] == ["deleted", "i1"]
    print("Parser and room/number/deleted-item selection checks passed.")


def main():
    if sys.argv[1:] == ["--self-test"]:
        self_test()
        return
    if os.getuid() != 0 or len(sys.argv) != 2:
        raise SystemExit("Run through the prepared root audit wrapper.")
    live_path = Path(sys.argv[1]).resolve(strict=True)
    live = json.loads(live_path.read_text(encoding="utf-8"))
    if live.get("readOnly") is not True:
        raise ValueError("readonly_live_snapshot_required")
    current = evidence(live["tables"])
    relevant_users = {r.get(key) for group in (current["rooms"], current["items"], current["audit"], current["responsibility"])
                      for r in group for key in ("actor_id", "created_by", "updated_by", "responsible_user_id", "started_by", "ended_by", "primary_responsible_id") if r.get(key)}
    current["actors"] = [u for u in live["tables"].get("users", []) if u["id"] in relevant_users]
    current["photos"] = [p for p in current["photos"] if p.get("item_id") in set(current["targetItemIds"])]
    base = Path("/var/backups/yu-inventory").resolve(strict=True)
    if str(base) != "/var/backups/yu-inventory":
        raise ValueError("unexpected_backup_directory")
    backups = []
    for path in sorted(base.glob("*.dump")):
        if path.is_symlink() or path.resolve().parent != base or not path.is_file():
            raise ValueError("unexpected_backup_file")
        stat = path.stat()
        entry = {"filename": path.name, "byteSize": stat.st_size,
                 "modifiedAt": datetime.fromtimestamp(stat.st_mtime, timezone.utc).isoformat()}
        try:
            toc = subprocess.run(["/usr/bin/pg_restore", "--list", str(path)], capture_output=True, text=True, encoding="utf-8", check=True, timeout=60).stdout
            entry["archiveHeader"] = [line for line in toc.splitlines() if line.startswith(";")][:18]
            entry["dataTablesPresent"] = [table for table in TABLES if re.search(r"TABLE DATA yu_inventory " + table + r"\s", toc)]
            digest = hashlib.sha256()
            with path.open("rb") as file:
                for chunk in iter(lambda: file.read(4 * 1024 * 1024), b""):
                    digest.update(chunk)
            entry["sha256"] = digest.hexdigest()
            command = ["/usr/bin/pg_restore", "--data-only", "--schema=yu_inventory", "--no-owner", "--no-privileges", "--file=-"]
            command += ["--table=" + table for table in TABLES]
            command += [str(path)]
            sql = subprocess.run(command, capture_output=True, text=True, encoding="utf-8", check=True, timeout=180).stdout
            tables = parse_copy(sql)
            for table in entry["dataTablesPresent"]:
                if table not in tables:
                    raise ValueError("expected_backup_table_not_parsed")
            entry["snapshot"] = evidence(tables)
            entry["ok"] = True
        except (subprocess.SubprocessError, ValueError, UnicodeError) as error:
            entry["ok"] = False
            entry["errorType"] = type(error).__name__
        backups.append(entry)
        print("Checked " + path.name + ": " + ("ok" if entry["ok"] else "failed"), file=sys.stderr, flush=True)
    report = {"readOnly": True, "productionRestored": False,
              "capturedAt": live["capturedAt"], "live": current, "backupDirectory": str(base), "backups": backups}
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
