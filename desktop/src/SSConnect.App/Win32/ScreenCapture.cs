using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;

namespace SSConnect.App.Win32
{
    public static class ScreenCapture
    {
        [DllImport("user32.dll")] static extern int GetSystemMetrics(int index);
        [DllImport("user32.dll")] static extern bool GetCursorInfo(ref CURSORINFO ci);
        [DllImport("user32.dll")] static extern bool GetIconInfo(IntPtr icon, out ICONINFO info);
        [DllImport("user32.dll")] static extern bool DrawIconEx(IntPtr hdc, int x, int y, IntPtr icon, int w, int h, int step, IntPtr brush, int flags);
        [DllImport("gdi32.dll")] static extern bool DeleteObject(IntPtr obj);

        [StructLayout(LayoutKind.Sequential)] struct POINT { public int X, Y; }
        [StructLayout(LayoutKind.Sequential)] struct CURSORINFO { public int cbSize, flags; public IntPtr hCursor; public POINT pt; }
        [StructLayout(LayoutKind.Sequential)] struct ICONINFO { public bool fIcon; public int xHotspot, yHotspot; public IntPtr hbmMask, hbmColor; }

        const int CURSOR_SHOWING = 1, DI_NORMAL = 3;

        public static Size PrimarySize() => new Size(GetSystemMetrics(0), GetSystemMetrics(1));

        public static Bitmap CapturePrimary(bool drawCursor = true)
        {
            var s = PrimarySize();
            var bmp = new Bitmap(s.Width, s.Height, PixelFormat.Format32bppArgb);
            using (var g = Graphics.FromImage(bmp))
            {
                g.CopyFromScreen(0, 0, 0, 0, s, CopyPixelOperation.SourceCopy);
                if (drawCursor) DrawCursor(g);
            }
            return bmp;
        }

        static void DrawCursor(Graphics g)
        {
            var ci = new CURSORINFO { cbSize = Marshal.SizeOf(typeof(CURSORINFO)) };
            if (!GetCursorInfo(ref ci) || ci.flags != CURSOR_SHOWING) return;
            if (!GetIconInfo(ci.hCursor, out var ii)) return;
            var hdc = g.GetHdc();
            try { DrawIconEx(hdc, ci.pt.X - ii.xHotspot, ci.pt.Y - ii.yHotspot, ci.hCursor, 0, 0, 0, IntPtr.Zero, DI_NORMAL); }
            finally
            {
                g.ReleaseHdc(hdc);
                if (ii.hbmMask != IntPtr.Zero) DeleteObject(ii.hbmMask);
                if (ii.hbmColor != IntPtr.Zero) DeleteObject(ii.hbmColor);
            }
        }
    }
}
