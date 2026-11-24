using System;
using System.Drawing;

namespace SSConnect.Core.Input
{
    public static class CoordMap
    {
        public static PointF ToNormalized(int x, int y, int w, int h) =>
            new PointF(Clamp(x / (float)w), Clamp(y / (float)h));

        public static Point ToPixels(float nx, float ny, int screenW, int screenH) =>
            new Point((int)Math.Min(screenW - 1, Math.Round(Clamp(nx) * screenW)),
                      (int)Math.Min(screenH - 1, Math.Round(Clamp(ny) * screenH)));

        static float Clamp(float v) => v < 0 ? 0 : v > 1 ? 1 : v;
    }
}
