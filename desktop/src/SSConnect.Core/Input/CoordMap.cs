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

        public static Rectangle Letterbox(Size source, Size box)
        {
            if (source.Width <= 0 || source.Height <= 0 || box.Width <= 0 || box.Height <= 0) return Rectangle.Empty;
            double scale = Math.Min(box.Width / (double)source.Width, box.Height / (double)source.Height);
            int w = (int)Math.Round(source.Width * scale, MidpointRounding.AwayFromZero);
            int h = (int)Math.Round(source.Height * scale, MidpointRounding.AwayFromZero);
            return new Rectangle((box.Width - w) / 2, (box.Height - h) / 2, w, h);
        }

        static float Clamp(float v) => v < 0 ? 0 : v > 1 ? 1 : v;
    }
}
