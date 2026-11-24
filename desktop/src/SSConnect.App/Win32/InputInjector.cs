using System;
using System.Drawing;
using System.Runtime.InteropServices;
using SSConnect.Core.Input;

namespace SSConnect.App.Win32
{
    public static class InputInjector
    {
        [DllImport("user32.dll", SetLastError = true)] static extern uint SendInput(uint count, INPUT[] inputs, int size);
        [DllImport("user32.dll")] static extern int GetSystemMetrics(int index);

        [StructLayout(LayoutKind.Sequential)] struct INPUT { public uint type; public InputUnion u; }
        [StructLayout(LayoutKind.Explicit)] struct InputUnion { [FieldOffset(0)] public MOUSEINPUT mi; [FieldOffset(0)] public KEYBDINPUT ki; }
        [StructLayout(LayoutKind.Sequential)] struct MOUSEINPUT { public int dx, dy; public int mouseData; public uint dwFlags, time; public IntPtr extra; }
        [StructLayout(LayoutKind.Sequential)] struct KEYBDINPUT { public ushort wVk, wScan; public uint dwFlags, time; public IntPtr extra; }

        const uint MOVE = 0x1, ABSOLUTE = 0x8000, VIRTUALDESK = 0x4000, WHEEL = 0x0800, KEYUP = 0x2, EXTENDED = 0x1;
        const int SM_XVIRTUALSCREEN = 76, SM_YVIRTUALSCREEN = 77, SM_CXVIRTUALSCREEN = 78, SM_CYVIRTUALSCREEN = 79;
        static readonly uint[] Down = { 0x2, 0x20, 0x8 };
        static readonly uint[] Up = { 0x4, 0x40, 0x10 };
        static readonly int[] ExtendedKeys = { 0x21, 0x22, 0x23, 0x24, 0x25, 0x26, 0x27, 0x28, 0x2D, 0x2E, 0xA3, 0xA5, 0x5B, 0x5C, 0x5D, 0x6F, 0x90 };

        public static void Apply(InputEvent e, Size screen)
        {
            const uint at = MOVE | ABSOLUTE | VIRTUALDESK;
            switch (e.Kind)
            {
                case "move": Mouse(e, screen, at, 0); break;
                case "down": Mouse(e, screen, at | Down[Button(e.Button)], 0); break;
                case "up": Mouse(e, screen, at | Up[Button(e.Button)], 0); break;
                case "wheel": Mouse(e, screen, at | WHEEL, e.Delta * 120); break;
                case "keydown": Key(e.Vk, false); break;
                case "keyup": Key(e.Vk, true); break;
            }
        }

        static int Button(int b) => b < 0 || b > 2 ? 0 : b;

        static void Mouse(InputEvent e, Size screen, uint flags, int data)
        {
            var p = CoordMap.ToPixels(e.X, e.Y, screen.Width, screen.Height);
            int vx = GetSystemMetrics(SM_XVIRTUALSCREEN), vy = GetSystemMetrics(SM_YVIRTUALSCREEN);
            int vw = GetSystemMetrics(SM_CXVIRTUALSCREEN), vh = GetSystemMetrics(SM_CYVIRTUALSCREEN);
            var i = new INPUT { type = 0 };
            i.u.mi.dx = (int)((p.X - vx) * 65535.0 / Math.Max(1, vw - 1));
            i.u.mi.dy = (int)((p.Y - vy) * 65535.0 / Math.Max(1, vh - 1));
            i.u.mi.dwFlags = flags;
            i.u.mi.mouseData = data;
            SendInput(1, new[] { i }, Marshal.SizeOf(typeof(INPUT)));
        }

        static void Key(int vk, bool up)
        {
            if (vk <= 0 || vk > 0xFE) return;
            var i = new INPUT { type = 1 };
            i.u.ki.wVk = (ushort)vk;
            i.u.ki.dwFlags = (up ? KEYUP : 0) | (Array.IndexOf(ExtendedKeys, vk) >= 0 ? EXTENDED : 0);
            SendInput(1, new[] { i }, Marshal.SizeOf(typeof(INPUT)));
        }
    }
}
