"""Read runtime/turn metadata without resuming or subscribing to agents."""
import json
import os
from pathlib import Path
import sys

sys.path.insert(0, os.environ["LOCAL_AGENTS_TIMER_ROOT"])
from shared_codex import ProxyClient

def inspect(ids):
    if not ids:
        return []
    executable = os.environ.get("LOCAL_AGENTS_CODEX_PATH") or str(Path(os.environ["LOCALAPPDATA"]) / "Programs/OpenAI/Codex/bin/codex.exe")
    client = ProxyClient(executable, timeout=2)
    values = []
    try:
        for thread_id in ids[:32]:
            try:
                thread = client.request("thread/read", {"threadId": thread_id, "includeTurns": False})["thread"]
                turns = client.request("thread/turns/list", {"threadId": thread_id, "limit": 1, "sortDirection": "desc", "itemsView": "notLoaded"}).get("data", [])
                turn, status = (turns[0] if turns else {}), (thread.get("status") or {})
                values.append({"id": thread_id, "status": status.get("type", "notLoaded"), "flags": status.get("activeFlags", []), "turnId": turn.get("id"), "turnStatus": turn.get("status")})
            except Exception:
                values.append({"id": thread_id, "error": True})
        return values
    finally:
        client.close()

if __name__ == "__main__":
    try:
        print(json.dumps(inspect(json.load(sys.stdin).get("threadIds", []))))
    except Exception:
        print(json.dumps({"error": "Agent status is unavailable"}))
        sys.exit(1)
