"""Use Windows' native taskbar attention state; never take keyboard focus."""
import ctypes
from ctypes import wintypes
import json
import sys
import time

def flash_app(active=True):
    user32 = ctypes.WinDLL("user32", use_last_error=True)
    class FlashInfo(ctypes.Structure):
        _fields_ = [("cbSize", wintypes.UINT), ("hwnd", wintypes.HWND),
                    ("dwFlags", wintypes.DWORD), ("uCount", wintypes.UINT),
                    ("dwTimeout", wintypes.DWORD)]
    user32.GetForegroundWindow.restype = wintypes.HWND
    user32.IsWindowVisible.argtypes = [wintypes.HWND]
    user32.GetWindowTextW.argtypes = [wintypes.HWND, wintypes.LPWSTR, ctypes.c_int]
    user32.GetClassNameW.argtypes = [wintypes.HWND, wintypes.LPWSTR, ctypes.c_int]
    user32.FlashWindowEx.argtypes = [ctypes.POINTER(FlashInfo)]
    callback_type = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
    matched, requested, focused = 0, 0, 0
    errors = []
    flashing = set()
    foreground = user32.GetForegroundWindow()
    @callback_type
    def visit(hwnd, _):
        nonlocal matched, requested, focused
        title, classname = ctypes.create_unicode_buffer(1024), ctypes.create_unicode_buffer(256)
        user32.GetWindowTextW(hwnd, title, len(title))
        user32.GetClassNameW(hwnd, classname, len(classname))
        is_app = (title.value in ("1a2o", "Zenro", "Open Inbox Zero") or title.value.endswith((" - 1a2o", " | 1a2o", " - Zenro", " | Zenro", " - Open Inbox Zero")))
        if is_app and classname.value.startswith("Chrome_WidgetWin") and user32.IsWindowVisible(hwnd):
            matched += 1
            if active and hwnd == foreground:
                stop = FlashInfo(ctypes.sizeof(FlashInfo), hwnd, 0, 0, 0)
                user32.FlashWindowEx(ctypes.byref(stop))
                focused += 1
                return True
            # TIMERNOFG makes Windows stop immediately on activation, independently of polling.
            info = FlashInfo(ctypes.sizeof(FlashInfo), hwnd, 0xE if active else 0, 7 if active else 0, 500)
            ctypes.set_last_error(0)
            user32.FlashWindowEx(ctypes.byref(info))
            error = ctypes.get_last_error()
            if error:
                errors.append(error)
            requested += 1
            if active:
                flashing.add(hwnd)
        return True
    user32.EnumWindows.argtypes = [callback_type, wintypes.LPARAM]
    if not user32.EnumWindows(visit, 0):
        raise ctypes.WinError(ctypes.get_last_error())
    if errors:
        raise ctypes.WinError(errors[0])
    # Let the native timer deliver a full flash sequence before this helper exits.
    if active and requested:
        message = wintypes.MSG()
        user32.PeekMessageW.argtypes = [ctypes.POINTER(wintypes.MSG), wintypes.HWND, wintypes.UINT, wintypes.UINT, wintypes.UINT]
        until = time.monotonic() + 4
        while time.monotonic() < until:
            current = user32.GetForegroundWindow()
            if current in flashing:
                stop = FlashInfo(ctypes.sizeof(FlashInfo), current, 0, 0, 0)
                user32.FlashWindowEx(ctypes.byref(stop))
                flashing.remove(current)
                focused += 1
                if not flashing:
                    break
            while user32.PeekMessageW(ctypes.byref(message), None, 0, 0, 1):
                user32.TranslateMessage(ctypes.byref(message))
                user32.DispatchMessageW(ctypes.byref(message))
            time.sleep(0.05)
    return {"matched": matched, "requested": requested, "focused": focused, "active": active}

if __name__ == "__main__":
    print(json.dumps(flash_app(active="--clear" not in sys.argv)))
