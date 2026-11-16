"""Windowless app launcher: background maintenance never gates an already-ready UI."""
from pathlib import Path
import ctypes
import subprocess
import sys
import time
import urllib.request
from open_notification import activate_app
from startup_window import show_startup_window

ROOT = Path(__file__).resolve().parents[2]
NODE = ROOT.parent / "tools/node-v24.22.1-win-x64/node.exe"


def application_ready(timeout=0.25):
    try:
        with urllib.request.urlopen("http://127.0.0.1:3000/api/auth/ok", timeout=timeout) as response:
            return response.status == 200
    except Exception:
        return False


def start_services(wait):
    folder = ROOT / ".context/logs"
    folder.mkdir(parents=True, exist_ok=True)
    with (folder / "startup.log").open("ab") as log:
        child = subprocess.Popen([str(NODE), str(ROOT / "scripts/local-openrouter/local.mjs"), "ensure"],
                                 cwd=ROOT, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
                                 stdin=subprocess.DEVNULL, stdout=log, stderr=log)
    if wait:
        deadline = time.monotonic() + 165
        while time.monotonic() < deadline:
            if application_ready(timeout=1.5):
                return
            if child.poll() is not None:
                raise RuntimeError("Services could not start. See .context/logs/startup.log.")
            time.sleep(0.25)
        raise RuntimeError("Startup timed out. See .context/logs/startup.log.")


def open_app(arguments):
    mailto = next((value for value in arguments if value.lower().startswith("mailto:")), None)
    command = [str(NODE), str(ROOT / "scripts/local-openrouter/open-notification.mjs"), "--app", "--services-ready"]
    if mailto:
        command.append(mailto)
    result = subprocess.run(command, cwd=ROOT, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
                            stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=170)
    if result.returncode != 0:
        raise RuntimeError("The app could not open. See .context/logs/notification-clicks.log.")
    return activate_app()


def main(arguments):
    services_only = "--services-only" in arguments
    if services_only:
        start_services(wait=True)
        return
    mailto = any(value.lower().startswith("mailto:") for value in arguments)
    if not mailto and activate_app(timeout=0.1):
        start_services(wait=False)
        return True
    if application_ready():
        start_services(wait=False)
        return open_app(arguments)
    return show_startup_window(lambda: start_services(wait=True), lambda: open_app(arguments))


if __name__ == "__main__":
    try:
        began = time.monotonic()
        focused = main(sys.argv[1:])
        folder = ROOT / ".context/logs"
        folder.mkdir(parents=True, exist_ok=True)
        with (folder / "startup.log").open("a", encoding="utf8") as log:
            mode = "background" if "--services-only" in sys.argv else "app"
            log.write(f"{time.time()} Startup completed mode={mode} focused={bool(focused)} seconds={time.monotonic()-began:.2f}\n")
    except Exception as error:
        folder = ROOT / ".context/logs"
        folder.mkdir(parents=True, exist_ok=True)
        with (folder / "startup.log").open("a", encoding="utf8") as log:
            log.write(f"{time.time()} Startup failed: {type(error).__name__}\n")
        if "--services-only" not in sys.argv:
            ctypes.windll.user32.MessageBoxW(None, str(error), "1a2o", 0x10)
        sys.exit(1)
