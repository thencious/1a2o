"""Show a responsive startup window while the local workspace becomes ready."""
from pathlib import Path
import ctypes
from ctypes import wintypes
import threading
import tkinter as tk


def show_startup_window(start_workspace, open_workspace):
    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel32.CreateMutexW.argtypes = [ctypes.c_void_p, wintypes.BOOL, wintypes.LPCWSTR]
    kernel32.CreateMutexW.restype = wintypes.HANDLE
    kernel32.CloseHandle.argtypes = [wintypes.HANDLE]
    ctypes.set_last_error(0)
    mutex = kernel32.CreateMutexW(None, False, "Local\\1a2o.StartupWindow")
    if not mutex:
        raise ctypes.WinError(ctypes.get_last_error())
    if ctypes.get_last_error() == 183:
        user32 = ctypes.WinDLL("user32", use_last_error=True)
        user32.FindWindowW.argtypes = [wintypes.LPCWSTR, wintypes.LPCWSTR]
        user32.FindWindowW.restype = wintypes.HWND
        user32.SetForegroundWindow.argtypes = [wintypes.HWND]
        user32.ShowWindowAsync.argtypes = [wintypes.HWND, ctypes.c_int]
        hwnd = user32.FindWindowW("TkTopLevel", "1a2o")
        if hwnd:
            user32.ShowWindowAsync(hwnd, 9)
            user32.SetForegroundWindow(hwnd)
        kernel32.CloseHandle(mutex)
        return False

    root = None
    try:
        root = tk.Tk()
        root.title("1a2o")
        root.configure(background="#171717")
        root.resizable(False, False)
        width, height = 480, 280
        root.geometry(f"{width}x{height}+{(root.winfo_screenwidth()-width)//2}+{(root.winfo_screenheight()-height)//2}")
        icon = Path(__file__).resolve().parents[2] / ".context/desktop/1a2o-ring.ico"
        try:
            root.iconbitmap(default=str(icon))
        except tk.TclError:
            pass
        root.update_idletasks()
        try:
            ctypes.windll.user32.GetParent.argtypes = [wintypes.HWND]
            ctypes.windll.user32.GetParent.restype = wintypes.HWND
            hwnd = ctypes.windll.user32.GetParent(root.winfo_id())
            enabled = ctypes.c_int(1)
            ctypes.windll.dwmapi.DwmSetWindowAttribute(hwnd, 20, ctypes.byref(enabled), ctypes.sizeof(enabled))
        except (AttributeError, OSError):
            pass
        logo = tk.Canvas(root, width=64, height=64, background="#171717", highlightthickness=0)
        logo.create_oval(10, 10, 54, 54, outline="white", width=5)
        logo.pack(pady=(28, 14))
        title = tk.Label(root, text="Starting 1a2o…", background="#171717", foreground="#dddddd", font=("Segoe UI", 17))
        title.pack()
        detail = tk.Label(root, text="Your workspace will open automatically.", background="#171717", foreground="#999999", font=("Segoe UI", 10), wraplength=420)
        detail.pack(pady=(10, 8))
        retry = tk.Button(root, text="Try again", background="#303030", foreground="#dddddd", activebackground="#414141", activeforeground="white", relief="flat", padx=16, pady=5)
        closed = threading.Event()
        result = {"focused": False}
        completion = []

        def close():
            closed.set()
            root.destroy()

        def work():
            try:
                start_workspace()
                if closed.is_set():
                    return
                focused = open_workspace()
                completion.append((focused, None))
            except Exception as error:
                completion.append((False, error))

        def run():
            title.configure(text="Starting 1a2o…")
            detail.configure(text="Your workspace will open automatically.")
            retry.pack_forget()
            threading.Thread(target=work, daemon=True).start()

        def poll():
            if closed.is_set():
                return
            if completion:
                focused, error = completion.pop(0)
                if error is None:
                    result["focused"] = focused
                    close()
                    return
                title.configure(text="1a2o couldn’t start")
                detail.configure(text=str(error))
                retry.pack(pady=4)
            root.after(75, poll)

        retry.configure(command=run)
        root.protocol("WM_DELETE_WINDOW", close)
        root.after(0, run)
        root.after(75, poll)
        root.mainloop()
        return result["focused"]
    finally:
        if root is not None:
            try:
                root.destroy()
            except tk.TclError:
                pass
        kernel32.CloseHandle(mutex)
