using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using SSConnect.Core.Platform;

namespace SSConnect.App.Win32
{
    public static class JpegCodec
    {
        static readonly ImageCodecInfo Jpeg = ImageCodecInfo.GetImageEncoders().First(c => c.FormatID == ImageFormat.Jpeg.Guid);

        public static byte[] Encode(Bitmap src, Rectangle r, int quality)
        {
            using (var tile = src.Clone(r, PixelFormat.Format24bppRgb))
            using (var ms = new MemoryStream())
            using (var p = new EncoderParameters(1))
            {
                p.Param[0] = new EncoderParameter(Encoder.Quality, (long)quality);
                tile.Save(ms, Jpeg, p);
                return ms.ToArray();
            }
        }

        public static Bitmap Decode(byte[] jpeg)
        {
            using (var ms = new MemoryStream(jpeg))
            using (var img = Image.FromStream(ms))
                return new Bitmap(img);
        }
    }

    public static class GdiFrames
    {
        // Copies a GDI+ bitmap into a Frame; the bitmap travels along as Native so encoding needs no copy back.
        public static Frame FromBitmap(Bitmap bmp)
        {
            int w = bmp.Width, h = bmp.Height, stride = w * 4;
            var bytes = new byte[stride * h];
            var data = bmp.LockBits(new Rectangle(0, 0, w, h), ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
            try { for (int y = 0; y < h; y++) Marshal.Copy(data.Scan0 + y * data.Stride, bytes, y * stride, stride); }
            finally { bmp.UnlockBits(data); }
            return new Frame(w, h, bytes, bmp);
        }

        public static Bitmap ToBitmap(Frame f)
        {
            var bmp = new Bitmap(f.Width, f.Height, PixelFormat.Format32bppArgb);
            var data = bmp.LockBits(new Rectangle(0, 0, f.Width, f.Height), ImageLockMode.WriteOnly, PixelFormat.Format32bppArgb);
            try { for (int y = 0; y < f.Height; y++) Marshal.Copy(f.Bgra, y * f.Width * 4, data.Scan0 + y * data.Stride, f.Width * 4); }
            finally { bmp.UnlockBits(data); }
            return bmp;
        }
    }

    public class GdiCodec : IImageCodec
    {
        public byte[] EncodeJpeg(Frame frame, Rectangle region, int quality)
        {
            if (frame.Native is Bitmap native) return JpegCodec.Encode(native, region, quality);
            using (var bmp = GdiFrames.ToBitmap(frame)) return JpegCodec.Encode(bmp, region, quality);
        }
    }

    // Viewer canvas backed by a GDI+ bitmap; RemoteView paints Bitmap under Lock.
    public class BitmapCanvas : ITileCanvas
    {
        public object Lock { get; } = new object();
        public Bitmap Bitmap { get; private set; }
        public int Width => Bitmap?.Width ?? 0;
        public int Height => Bitmap?.Height ?? 0;

        public void Resize(int width, int height)
        {
            lock (Lock) { Bitmap?.Dispose(); Bitmap = new Bitmap(width, height); }
        }

        public void DrawJpeg(byte[] jpeg, int x, int y, int width, int height)
        {
            using (var img = JpegCodec.Decode(jpeg))
            lock (Lock)
                using (var g = Graphics.FromImage(Bitmap)) g.DrawImage(img, x, y, width, height);
        }
    }
}
