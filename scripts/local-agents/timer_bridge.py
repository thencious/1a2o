"""JSONL adapter to the user's existing timer; owns a separate durable queue."""
import json
import os
from pathlib import Path
import queue
import sys
import threading
import time
import subprocess
from dataclasses import asdict

sys.path.insert(0, os.environ["LOCAL_AGENTS_TIMER_ROOT"])
from core import Task, Store, Scheduler, discover_chats, reasoning_levels, automatic_directory, parse_delay
from shared_codex import ProxyClient, BusyChat, deliver_to_open_chat
from rate_limits import read_five_hour_reset, default_delay

executable = os.environ["LOCAL_AGENTS_CODEX_PATH"]
scheduler = Scheduler(Store(Path(os.environ["LOCAL_AGENTS_DATA"]) / "queue"), executable)
output_lock = threading.Lock()
terminal_replies = {}
def emit(value):
    with output_lock:
        print(json.dumps(value, ensure_ascii=False), flush=True)
def run_task(task):
    client = ProxyClient(executable)
    try:
        thread = client.request("thread/read", {"threadId": task.chat_id})["thread"]
        loaded = thread.get("status", {}).get("type") in {"active", "idle", "systemError"}
    except Exception:
        loaded = False
    finally:
        client.close()
    if loaded:
        try:
            return deliver_to_open_chat(executable, task)
        except BusyChat as error:
            return -2, str(error)
    result = scheduler._run(task)
    if result[0] == -2:
        client = ProxyClient(executable)
        submitted = False
        try:
            submitted = True
            queued = client.request("thread/queue/add", {"threadId": task.chat_id, "clientUserMessageId": task.delivery_id,
                "input": [{"type": "text", "text": task.message}]})
            with open(task.log, "a", encoding="utf-8") as log:
                log.write(json.dumps({"delivery": "existing CLI queue", "queuedSubmission": queued}) + "\n")
            return 0, ""
        except Exception as error:
            return 1, "Queue delivery could not be confirmed. Check the chat before retrying. " + str(error)
        finally:
            client.close()
    if result[0] == 1 and task.log and "no rollout found for thread id" in Path(task.log).read_text(encoding="utf-8", errors="replace")[-16384:]:
        reply = queue.Queue()
        terminal_replies[task.delivery_id] = reply
        emit({"event": "terminal_delivery", "deliveryId": task.delivery_id, "chatId": task.chat_id, "message": task.message})
        try:
            error = reply.get(timeout=15)
            return (1, error) if error else (0, "")
        except queue.Empty:
            return 1, "Terminal delivery could not be confirmed. Check the terminal before retrying."
        finally:
            terminal_replies.pop(task.delivery_id, None)
    return result
scheduler.runner = run_task
requests = queue.Queue()
reset = None
reset_error = "Reading Codex reset time…"
chats = []
refreshed = 0

def limits():
    global reset, reset_error
    while True:
        try:
            reset = read_five_hour_reset(executable)
            reset_error = "" if reset else "No upcoming five-hour reset is available. Enter a delay."
        except Exception as error:
            reset_error = str(error)
        time.sleep(60)

def handle(method, args):
    global chats, refreshed
    if method == "ensure_server":
        try:
            client = ProxyClient(executable)
            client.close()
            return True
        except Exception:
            subprocess.Popen([executable, "app-server", "--listen", "unix://"], stdin=subprocess.DEVNULL,
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
            for _ in range(30):
                try:
                    client = ProxyClient(executable, timeout=1)
                    client.close()
                    return True
                except Exception:
                    time.sleep(0.2)
            raise RuntimeError("The shared Codex server did not become available.")
    if method == "terminal_result":
        reply = terminal_replies.get(args["deliveryId"])
        if reply:
            reply.put(args.get("error", ""))
        return True
    if method == "metadata":
        if time.time() - refreshed > 15:
            chats, refreshed = discover_chats(), time.time()
        return {"chats": [asdict(chat) for chat in chats], "levels": reasoning_levels(),
                "reset": asdict(reset) | {"send_at": reset.send_at} if reset else None,
                "resetError": reset_error, "codex": executable}
    if method == "new":
        cwd = args["cwd"]
        if not Path(cwd).is_dir():
            raise ValueError("Choose an existing working folder.")
        client = ProxyClient(executable)
        try:
            result = client.request("thread/start", {"cwd": cwd})
            return {"id": result["thread"]["id"], "cwd": cwd}
        finally:
            client.close()
    if method == "state":
        return [asdict(task) for task in scheduler.tasks]
    task = next((task for task in scheduler.tasks if task.id == args.get("taskId")), None)
    if method in {"timer", "send"}:
        if method == "timer":
            if args.get("delay") and parse_delay(args["delay"]) <= 0:
                raise ValueError("Choose a future delay. Scheduling never sends immediately.")
            if args.get("due") is not None and args["due"] <= time.time() + 1:
                raise ValueError("Choose a future schedule time.")
        if task and task.status in {"running", "resuming"}:
            raise ValueError("This task is already running. Wait for it before sending again.")
        if method == "send" and task and task.status == "scheduled" and task.delay == "0:00":
            raise ValueError("This message is already queued.")
        if not task:
            task = Task(default_timer=False)
            scheduler.tasks.append(task)
        for key in ["chat_id", "chat_title", "cwd", "model", "effort", "message", "cwd_manual"]:
            if key in args:
                setattr(task, key, args[key])
        if not task.cwd or not Path(task.cwd).is_dir():
            raise ValueError("Choose an existing working folder.")
        if method == "send":
            task.default_timer, task.default_due, task.delay = False, None, "0:00"
            scheduler.start(task)
        elif args.get("due") is not None:
            task.default_timer, task.default_due = False, None
            task.delay = default_delay(args["due"], time.time())
            scheduler.start(task, validate=False, deadline=args["due"])
        elif args.get("delay"):
            task.default_timer, task.default_due = False, None
            task.delay = args["delay"]
            scheduler.start(task, validate=False)
        elif reset:
            task.default_timer, task.default_due = True, reset.send_at
            task.delay = default_delay(reset.send_at, time.time())
            scheduler.start(task, validate=False, deadline=reset.send_at)
        else:
            scheduler.save()
            raise ValueError(reset_error)
        return asdict(task)
    if not task:
        return None
    if method == "edit":
        if task.status not in {"running", "resuming"} and not (task.status == "scheduled" and task.delay == "0:00"):
            for key in ["message", "effort", "model", "cwd", "chat_id", "chat_title"]:
                if key in args:
                    setattr(task, key, args[key])
            scheduler.save()
    elif method == "editing":
        if args.get("active"):
            scheduler.editing.add(task.id)
        else:
            scheduler.editing.discard(task.id)
    elif method == "pause":
        scheduler.resume(task) if task.status == "paused" else scheduler.pause(task)
    elif method == "cancel":
        scheduler.cancel(task)
        scheduler.editing.discard(task.id)
    return asdict(task)

def read():
    for line in sys.stdin:
        try:
            requests.put(json.loads(line))
        except ValueError:
            continue
    requests.put(None)

threading.Thread(target=read, daemon=True).start()
threading.Thread(target=limits, daemon=True).start()
while True:
    try:
        scheduler.tick()
        request = requests.get(timeout=0.2)
    except queue.Empty:
        continue
    if request is None:
        break
    try:
        result = {"id": request["id"], "result": handle(request["method"], request.get("args", {}))}
    except Exception as error:
        result = {"id": request["id"], "error": str(error)}
    emit(result)
