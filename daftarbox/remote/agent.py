"""
SS-Connect  v1.0  — Remote Control Agent
Allows IT support to control this PC via the Core Tools portal.
Run this, then open the remote access page and share your screen.
"""
import asyncio, json, sys, threading, os, subprocess

# ── Auto-install dependencies ──
def _install(pkg):
    subprocess.check_call([sys.executable, "-m", "pip", "install", pkg, "-q"],
                          stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

for _pkg in ("pyautogui", "websockets"):
    try:
        __import__(_pkg)
    except ImportError:
        print(f"Installing {_pkg}…")
        _install(_pkg)

import pyautogui
import websockets

pyautogui.FAILSAFE = False
pyautogui.PAUSE = 0

KEY_MAP = {
    "Enter":"enter","Backspace":"backspace","Delete":"delete","Tab":"tab",
    "Escape":"esc","ArrowUp":"up","ArrowDown":"down","ArrowLeft":"left",
    "ArrowRight":"right","Home":"home","End":"end","PageUp":"pageup",
    "PageDown":"pagedown","Insert":"insert","Control":"ctrl","Alt":"alt",
    "Shift":"shift","Meta":"win"," ":"space","CapsLock":"capslock",
    "F1":"f1","F2":"f2","F3":"f3","F4":"f4","F5":"f5","F6":"f6",
    "F7":"f7","F8":"f8","F9":"f9","F10":"f10","F11":"f11","F12":"f12",
}

# ── UI ──
try:
    import tkinter as tk
    from tkinter import font as tkfont
    HAS_TK = True
except ImportError:
    HAS_TK = False

ui_status_var = None
ui_conn_var   = None

def build_ui(stop_event):
    root = tk.Tk()
    root.title("SS-Connect – Remote Control Agent")
    root.geometry("400x240")
    root.resizable(False, False)
    root.configure(bg="#0f1117")

    try:
        # Try to set icon (works when packaged as .exe/.app)
        if getattr(sys, 'frozen', False):
            base = sys._MEIPASS
        else:
            base = os.path.dirname(os.path.abspath(__file__))
    except Exception:
        pass

    pad = {"padx": 24, "pady": 0}

    tk.Label(root, text="SS-Connect", bg="#0f1117", fg="#4f6ef7",
             font=("Segoe UI", 18, "bold")).pack(pady=(24,2))
    tk.Label(root, text="Remote Control Agent  v1.0", bg="#0f1117", fg="#6b7280",
             font=("Segoe UI", 11)).pack()

    sep = tk.Frame(root, bg="#2d3148", height=1)
    sep.pack(fill="x", padx=24, pady=16)

    global ui_status_var, ui_conn_var
    ui_status_var = tk.StringVar(value="⏳  Starting…")
    ui_conn_var   = tk.StringVar(value="No controller connected")

    tk.Label(root, textvariable=ui_status_var, bg="#0f1117", fg="#e8eaf6",
             font=("Segoe UI", 12, "bold")).pack(**pad)
    tk.Label(root, textvariable=ui_conn_var, bg="#0f1117", fg="#6b7280",
             font=("Segoe UI", 10)).pack(pady=(4,0), **pad)

    sep2 = tk.Frame(root, bg="#2d3148", height=1)
    sep2.pack(fill="x", padx=24, pady=16)

    def on_stop():
        stop_event.set()
        root.destroy()

    tk.Button(root, text="Stop Agent", command=on_stop,
              bg="#ef4444", fg="white", font=("Segoe UI", 10, "bold"),
              relief="flat", padx=20, pady=6, cursor="hand2").pack()

    root.protocol("WM_DELETE_WINDOW", on_stop)
    root.mainloop()

def set_ui(status=None, conn=None):
    try:
        if status and ui_status_var: ui_status_var.set(status)
        if conn   and ui_conn_var:   ui_conn_var.set(conn)
    except Exception:
        pass

# ── WebSocket handler ──
async def handler(ws):
    sw, sh = pyautogui.size()
    addr = ws.remote_address[0] if ws.remote_address else "unknown"
    print(f"✅ Controller connected from {addr}  (screen {sw}×{sh})")
    set_ui("🟢  Controller connected", f"Connected from {addr}")
    try:
        async for msg in ws:
            ev = json.loads(msg)
            t  = ev.get("type","")
            x  = int(ev.get("x", 0) * sw)
            y  = int(ev.get("y", 0) * sh)
            if   t == "move":     pyautogui.moveTo(x, y, duration=0)
            elif t == "click":    pyautogui.click(x, y, button=ev.get("btn","left"))
            elif t == "dblclick": pyautogui.doubleClick(x, y)
            elif t == "mousedown":pyautogui.mouseDown(x, y, button=ev.get("btn","left"))
            elif t == "mouseup":  pyautogui.mouseUp(x, y, button=ev.get("btn","left"))
            elif t == "scroll":   pyautogui.scroll(int(ev.get("dy",0)), x=x, y=y)
            elif t in ("keydown","keyup"):
                raw = ev.get("key","")
                k = KEY_MAP.get(raw, raw.lower() if len(raw)==1 else None)
                if k:
                    (pyautogui.keyDown if t=="keydown" else pyautogui.keyUp)(k)
    except Exception as e:
        print(f"Session ended: {e}")
    print("Controller disconnected")
    set_ui("🟡  Waiting for controller", "No controller connected")

async def serve(stop_event):
    async with websockets.serve(handler, "localhost", 9001):
        set_ui("🟡  Waiting for controller", "Listening on localhost:9001")
        print("Listening on ws://localhost:9001 — open the remote page and share your screen.")
        while not stop_event.is_set():
            await asyncio.sleep(0.5)

def run_server(stop_event):
    asyncio.run(serve(stop_event))

# ── Main ──
if __name__ == "__main__":
    print("=" * 52)
    print("  SS-Connect  v1.0 – Remote Control Agent")
    print("  Chamaria Group IT")
    print("=" * 52)

    stop_event = threading.Event()

    server_thread = threading.Thread(target=run_server, args=(stop_event,), daemon=True)
    server_thread.start()

    if HAS_TK:
        build_ui(stop_event)   # blocks until window closed
    else:
        print("Running in console mode. Press Ctrl+C to stop.")
        try:
            server_thread.join()
        except KeyboardInterrupt:
            stop_event.set()
            print("\nAgent stopped.")
