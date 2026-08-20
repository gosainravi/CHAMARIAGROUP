"""
Chamaria Group — IT Asset Discovery Agent
Run this on any Windows PC to automatically collect system info
and push it to the IT Asset Management Portal for review.

Compile to .exe:
  pip install pyinstaller requests
  pyinstaller --onefile --windowed --name "Chamaria_IT_Agent" chamaria_it_agent.py
"""

import sys
import json
import socket
import platform
import subprocess
import datetime
import os
import urllib.request
import urllib.error

# ─── CONFIGURE THESE ───────────────────────────────────────────────────────────
SUPABASE_URL = "https://bnaoylezumflyvfdmsnm.supabase.co"
SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJuYW95bGV6dW1mbHl2ZmRtc25tIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU0OTk3NTIsImV4cCI6MjEwMTA3NTc1Mn0.MG8UmI7d7TrqWnwgAPp5dv3sEdTrNv5vuyV3lZDwYEI"
PORTAL_URL   = "https://gosainravi.github.io/IT-Asset-Management/"
# ───────────────────────────────────────────────────────────────────────────────

def ps(cmd):
    """Run PowerShell command and return stdout"""
    try:
        result = subprocess.run(
            ["powershell", "-NoProfile", "-NonInteractive", "-Command", cmd],
            capture_output=True, text=True, timeout=30
        )
        return result.stdout.strip()
    except Exception:
        return ""

def collect_system_info():
    info = {}

    # ── Basic info ──────────────────────────────────────────────────────────────
    info["computer_name"]    = socket.gethostname()
    info["username"]         = os.environ.get("USERNAME", os.environ.get("USER", "Unknown"))
    info["os_name"]          = ps("(Get-WmiObject Win32_OperatingSystem).Caption")
    info["os_version"]       = ps("(Get-WmiObject Win32_OperatingSystem).Version")
    info["os_build"]         = ps("(Get-WmiObject Win32_OperatingSystem).BuildNumber")
    info["os_arch"]          = ps("(Get-WmiObject Win32_OperatingSystem).OSArchitecture")

    # ── Hardware ─────────────────────────────────────────────────────────────────
    info["manufacturer"]     = ps("(Get-WmiObject Win32_ComputerSystem).Manufacturer")
    info["model"]            = ps("(Get-WmiObject Win32_ComputerSystem).Model")
    info["serial_number"]    = ps("(Get-WmiObject Win32_BIOS).SerialNumber")
    info["bios_version"]     = ps("(Get-WmiObject Win32_BIOS).SMBIOSBIOSVersion")
    info["system_type"]      = ps("(Get-WmiObject Win32_ComputerSystem).SystemType")

    # ── Processor ────────────────────────────────────────────────────────────────
    info["processor"]        = ps("(Get-WmiObject Win32_Processor | Select-Object -First 1).Name")
    info["processor_cores"]  = ps("(Get-WmiObject Win32_Processor | Select-Object -First 1).NumberOfCores")
    info["processor_speed"]  = ps("[math]::Round((Get-WmiObject Win32_Processor | Select-Object -First 1).MaxClockSpeed / 1000, 1)")

    # ── RAM ──────────────────────────────────────────────────────────────────────
    ram_bytes = ps("(Get-WmiObject Win32_PhysicalMemory | Measure-Object -Property Capacity -Sum).Sum")
    try:
        info["ram_gb"] = str(round(int(ram_bytes) / (1024**3), 1)) + " GB"
    except:
        info["ram_gb"] = ram_bytes

    # ── Storage ──────────────────────────────────────────────────────────────────
    disk_info = ps("""
Get-WmiObject Win32_DiskDrive | ForEach-Object {
    $size = [math]::Round($_.Size / 1GB, 0)
    "$($_.Model) - ${size}GB ($($_.MediaType))"
} | Join-String -Separator ' | '
""")
    info["storage"] = disk_info or ps("(Get-WmiObject Win32_DiskDrive | Select-Object -First 1 -ExpandProperty Model)")

    # Logical disk free space
    info["free_space"] = ps("""
Get-WmiObject Win32_LogicalDisk -Filter "DriveType=3" | ForEach-Object {
    "$($_.DeviceID) $('{0:N0}' -f ($_.FreeSpace/1GB))GB free of $('{0:N0}' -f ($_.Size/1GB))GB"
} | Join-String -Separator ' | '
""")

    # ── Network ──────────────────────────────────────────────────────────────────
    net_info = ps("""
$adapter = Get-WmiObject Win32_NetworkAdapterConfiguration | Where-Object {$_.IPEnabled} | Select-Object -First 1
"$($adapter.IPAddress[0]) | MAC: $($adapter.MACAddress) | GW: $($adapter.DefaultIPGateway[0])"
""")
    parts = net_info.split(" | ")
    info["ip_address"]  = parts[0].strip() if parts else ""
    info["mac_address"] = parts[1].replace("MAC: ", "").strip() if len(parts) > 1 else ""
    info["gateway"]     = parts[2].replace("GW: ", "").strip() if len(parts) > 2 else ""

    # ── Graphics ─────────────────────────────────────────────────────────────────
    info["graphics"] = ps("(Get-WmiObject Win32_VideoController | Select-Object -First 1).Caption")

    # ── Monitor ──────────────────────────────────────────────────────────────────
    info["monitor"]  = ps("(Get-WmiObject Win32_DesktopMonitor | Select-Object -First 1).Name")

    # ── Battery (for laptops) ──────────────────────────────────────────────────
    battery = ps("(Get-WmiObject Win32_Battery | Select-Object -First 1).Name")
    info["battery"] = battery if battery else "No Battery (Desktop)"

    # ── Installed Software ────────────────────────────────────────────────────────
    software_list = ps("""
$paths = @(
    'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',
    'HKLM:\\Software\\Wow6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',
    'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*'
)
Get-ItemProperty $paths -ErrorAction SilentlyContinue |
    Where-Object { $_.DisplayName -and $_.DisplayName -notmatch '^\s*$' } |
    Select-Object DisplayName, DisplayVersion, Publisher |
    Sort-Object DisplayName -Unique |
    ForEach-Object { "$($_.DisplayName)|$($_.DisplayVersion)|$($_.Publisher)" } |
    Join-String -Separator ';;'
""")
    info["installed_software_raw"] = software_list

    # Parse software into list
    software = []
    for entry in software_list.split(";;"):
        parts = entry.split("|")
        if parts and parts[0].strip():
            software.append({
                "name":      parts[0].strip(),
                "version":   parts[1].strip() if len(parts) > 1 else "",
                "publisher": parts[2].strip() if len(parts) > 2 else ""
            })
    info["installed_software"] = software[:100]  # Cap at 100

    # ── Last Boot ────────────────────────────────────────────────────────────────
    info["last_boot"] = ps("(Get-WmiObject Win32_OperatingSystem).LastBootUpTime")

    # ── Metadata ─────────────────────────────────────────────────────────────────
    info["agent_version"]  = "1.0.0"
    info["scan_timestamp"] = datetime.datetime.now().isoformat()
    info["status"]         = "pending"

    return info


def send_to_portal(info):
    """Send collected info to Supabase asset_discovery table"""
    url = SUPABASE_URL + "/rest/v1/asset_discovery"
    payload = json.dumps(info).encode("utf-8")
    req = urllib.request.Request(
        url, data=payload, method="POST",
        headers={
            "Content-Type":  "application/json",
            "apikey":        SUPABASE_KEY,
            "Authorization": "Bearer " + SUPABASE_KEY,
            "Prefer":        "return=minimal"
        }
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            return resp.status in (200, 201)
    except urllib.error.HTTPError as e:
        print("HTTP Error:", e.code, e.read().decode())
        return False
    except Exception as e:
        print("Error:", e)
        return False


def show_gui(info, success):
    """Simple Tkinter GUI to show results"""
    try:
        import tkinter as tk
        from tkinter import scrolledtext, messagebox

        root = tk.Tk()
        root.title("Chamaria IT Asset Agent — System Scan Complete")
        root.geometry("700x550")
        root.configure(bg="#121316")
        root.resizable(True, True)

        # Header
        header = tk.Frame(root, bg="#E31E2A", padx=20, pady=12)
        header.pack(fill="x")
        tk.Label(header, text="🖥  Chamaria Group — IT Asset Discovery Agent",
                 bg="#E31E2A", fg="white", font=("Segoe UI", 13, "bold")).pack(side="left")
        tk.Label(header, text="v1.0.0", bg="#E31E2A", fg="rgba(255,255,255,0.7)",
                 font=("Segoe UI", 9)).pack(side="right")

        # Status
        status_bg = "#1a3a1a" if success else "#3a1a1a"
        status_txt = "✅  Data sent to IT Portal — IT Admin will review shortly." if success else "❌  Could not connect to portal. Check internet and try again."
        tk.Label(root, text=status_txt, bg=status_bg, fg="#90EE90" if success else "#FF6B6B",
                 font=("Segoe UI", 10), pady=8).pack(fill="x")

        # Info display
        frame = tk.Frame(root, bg="#121316", padx=14, pady=10)
        frame.pack(fill="both", expand=True)
        tk.Label(frame, text="System Information Collected:", bg="#121316", fg="#A9ABAD",
                 font=("Segoe UI", 9)).pack(anchor="w")

        text = scrolledtext.ScrolledText(frame, font=("Consolas", 9), bg="#1E1F21",
                                          fg="#E4E4E3", wrap="word", height=20)
        text.pack(fill="both", expand=True, pady=(4, 0))

        display = [
            ("Computer Name",    info.get("computer_name","")),
            ("User",             info.get("username","")),
            ("Manufacturer",     info.get("manufacturer","")),
            ("Model",            info.get("model","")),
            ("Serial Number",    info.get("serial_number","")),
            ("OS",               info.get("os_name","") + " " + info.get("os_arch","")),
            ("Processor",        info.get("processor","")),
            ("RAM",              info.get("ram_gb","")),
            ("Storage",          info.get("storage","")),
            ("Free Space",       info.get("free_space","")),
            ("IP Address",       info.get("ip_address","")),
            ("MAC Address",      info.get("mac_address","")),
            ("Graphics",         info.get("graphics","")),
            ("Battery",          info.get("battery","")),
            ("Software Installed", str(len(info.get("installed_software",[]))) + " apps found"),
            ("Scan Time",        info.get("scan_timestamp","")[:19]),
        ]
        for label, value in display:
            text.insert("end", f"  {label:<22} {value}\n")

        text.insert("end", "\n  Installed Software (first 20):\n")
        for sw in info.get("installed_software",[])[:20]:
            text.insert("end", f"    • {sw['name']}" + (f" v{sw['version']}" if sw['version'] else "") + "\n")
        if len(info.get("installed_software",[])) > 20:
            text.insert("end", f"    … and {len(info.get('installed_software',[]))-20} more\n")
        text.config(state="disabled")

        # Footer
        foot = tk.Frame(root, bg="#121316", pady=8)
        foot.pack(fill="x")
        if success:
            tk.Label(foot, text=f"Open portal: {PORTAL_URL}",
                     bg="#121316", fg="#5A5F63", font=("Consolas", 8), cursor="hand2").pack()
        tk.Button(foot, text="Close", command=root.destroy, bg="#E31E2A", fg="white",
                  font=("Segoe UI", 10, "bold"), relief="flat", padx=24, pady=6).pack(pady=4)

        root.mainloop()

    except ImportError:
        # No GUI — print to console
        print("\n" + "="*50)
        print("CHAMARIA IT ASSET AGENT — SCAN COMPLETE")
        print("="*50)
        for k, v in info.items():
            if k not in ("installed_software", "installed_software_raw"):
                print(f"{k:<25}: {v}")
        print(f"\nSoftware count: {len(info.get('installed_software',[]))}")
        print(f"\nStatus: {'SUCCESS — sent to portal' if success else 'FAILED — check connection'}")


def main():
    print("Chamaria IT Asset Agent — Scanning system…")
    info = collect_system_info()
    print(f"Collected: {info.get('computer_name')} | {info.get('model')} | {info.get('serial_number')}")
    print(f"Software: {len(info.get('installed_software',[]))} apps")
    print("Sending to portal…")
    success = send_to_portal(info)
    print("Done!" if success else "Failed to send.")
    show_gui(info, success)


if __name__ == "__main__":
    main()
