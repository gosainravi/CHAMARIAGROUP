using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;

namespace SSConnect.Core.Screen
{
    public class Tile
    {
        public int X, Y, W, H;
        public byte[] Jpeg;
    }

    public class TileDiffer
    {
        readonly int size;
        byte[] prev;
        int pw, ph;

        public TileDiffer(int tileSize = 64) { size = tileSize; }

        public List<Rectangle> Changed(Bitmap frame, bool forceAll)
        {
            int w = frame.Width, h = frame.Height, stride = w * 4;
            var data = frame.LockBits(new Rectangle(0, 0, w, h), ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
            var cur = new byte[stride * h];
            for (int y = 0; y < h; y++) Marshal.Copy(data.Scan0 + y * data.Stride, cur, y * stride, stride);
            frame.UnlockBits(data);

            bool all = forceAll || prev == null || pw != w || ph != h;
            var result = new List<Rectangle>();
            for (int ty = 0; ty < h; ty += size)
                for (int tx = 0; tx < w; tx += size)
                {
                    var r = new Rectangle(tx, ty, Math.Min(size, w - tx), Math.Min(size, h - ty));
                    if (all || Differs(cur, r, stride)) result.Add(r);
                }
            prev = cur; pw = w; ph = h;
            return result;
        }

        // Joins touching tiles in the same row: fewer, larger JPEGs compress far better than many small ones.
        public static List<Rectangle> MergeRows(IList<Rectangle> rects)
        {
            var merged = new List<Rectangle>();
            foreach (var r in rects)
            {
                if (merged.Count > 0)
                {
                    var last = merged[merged.Count - 1];
                    if (last.Y == r.Y && last.Height == r.Height && last.Right == r.X)
                    {
                        merged[merged.Count - 1] = new Rectangle(last.X, last.Y, last.Width + r.Width, last.Height);
                        continue;
                    }
                }
                merged.Add(r);
            }
            return merged;
        }

        bool Differs(byte[] cur, Rectangle r, int stride)
        {
            int rowBytes = r.Width * 4;
            for (int y = r.Top; y < r.Bottom; y++)
            {
                int off = y * stride + r.Left * 4;
                for (int i = 0; i < rowBytes; i++)
                    if (cur[off + i] != prev[off + i]) return true;
            }
            return false;
        }
    }
}
