"""Windowless Windows protocol entry point for notification clicks."""
from pathlib import Path
import ctypes
from ctypes import wintypes
import json
import subprocess
import sys
import time


def focus_existing_app(timeout=5):
    user32 = ctypes.WinDLL("user32", use_last_error=True)
    user32.GetWindowTextW.argtypes = [wintypes.HWND, wintypes.LPWSTR, ctypes.c_int]
    user32.GetClassNameW.argtypes = [wintypes.HWND, wintypes.LPWSTR, ctypes.c_int]
    user32.IsWindowVisible.argtypes = [wintypes.HWND]
    user32.IsIconic.argtypes = [wintypes.HWND]
    user32.ShowWindowAsync.argtypes = [wintypes.HWND, ctypes.c_int]
    user32.SetForegroundWindow.argtypes = [wintypes.HWND]
    user32.GetForegroundWindow.restype = wintypes.HWND
    callback_type = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
    user32.EnumWindows.argtypes = [callback_type, wintypes.LPARAM]
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        windows = []
        @callback_type
        def visit(hwnd, _):
            title, classname = ctypes.create_unicode_buffer(1024), ctypes.create_unicode_buffer(256)
            user32.GetWindowTextW(hwnd, title, len(title))
            user32.GetClassNameW(hwnd, classname, len(classname))
            if (title.value in ("1a2o", "Zenro", "Open Inbox Zero") or title.value.endswith((" - 1a2o", " | 1a2o", " - Zenro", " | Zenro", " - Open Inbox Zero"))) and classname.value.startswith("Chrome_WidgetWin") and user32.IsWindowVisible(hwnd):
                windows.append(hwnd)
            return True
        user32.EnumWindows(visit, 0)
        if windows:
            hwnd = windows[0]
            if user32.IsIconic(hwnd):
                user32.ShowWindowAsync(hwnd, 9)
            focused = user32.GetForegroundWindow() == hwnd or bool(user32.SetForegroundWindow(hwnd))
            return {"exists": True, "focused": focused}
        time.sleep(0.1)
    return {"exists": False, "focused": False}


def activate_app(timeout=5):
    return focus_existing_app(timeout)["focused"]

if __name__ == "__main__" and "--focus-existing" in sys.argv:
    print(json.dumps(focus_existing_app(timeout=0.15)))
elif __name__ == "__main__" and len(sys.argv) > 1:
    root = Path(__file__).resolve().parents[2]
    node = root.parent / "tools/node-v24.22.1-win-x64/node.exe"
    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel32.CreateMutexW.argtypes = [ctypes.c_void_p, wintypes.BOOL, wintypes.LPCWSTR]
    kernel32.CreateMutexW.restype = wintypes.HANDLE
    kernel32.WaitForSingleObject.argtypes = [wintypes.HANDLE, wintypes.DWORD]
    kernel32.ReleaseMutex.argtypes = [wintypes.HANDLE]
    kernel32.CloseHandle.argtypes = [wintypes.HANDLE]
    mutex = kernel32.CreateMutexW(None, False, "Local\\ZenroNotificationActivation")
    held = False
    try:
        if not mutex:
            raise ctypes.WinError(ctypes.get_last_error())
        held = kernel32.WaitForSingleObject(mutex, 170000) in (0, 0x80)
        if not held:
            raise RuntimeError("Another notification activation is still running")
        result = subprocess.run([str(node), str(root / "scripts/local-openrouter/open-notification.mjs"), sys.argv[1]],
                                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0), timeout=140,
                                stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        focused = result.returncode == 0 and activate_app()
        status = {"at": time.time(), "launched": result.returncode == 0, "focused": focused}
    except Exception:
        status = {"at": time.time(), "launched": False, "focused": False}
    finally:
        if held:
            kernel32.ReleaseMutex(mutex)
        if mutex:
            kernel32.CloseHandle(mutex)
    folder = root / ".context/logs"
    folder.mkdir(parents=True, exist_ok=True)
    (folder / "notification-click-status.json").write_text(json.dumps(status), encoding="utf8")
