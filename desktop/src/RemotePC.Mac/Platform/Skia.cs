using System;
using System.Drawing;
using SkiaSharp;
using SSConnect.Core.Platform;

namespace RemotePC.Mac.Platform;

public sealed class SkiaCodec : IImageCodec
{
    public unsafe byte[] EncodeJpeg(Frame frame, Rectangle region, int quality)
    {
        var info = new SKImageInfo(region.Width, region.Height, SKColorType.Bgra8888, SKAlphaType.Premul);
        fixed (byte* p = frame.Bgra)
        {
            var start = (IntPtr)(p + ((long)region.Y * frame.Width + region.X) * 4);
            using var pixmap = new SKPixmap(info, start, frame.Width * 4);
            using var image = SKImage.FromPixels(pixmap);
            using var data = image.Encode(SKEncodedImageFormat.Jpeg, quality);
            return data.ToArray();
        }
    }
}

// Viewer-side picture of the remote screen. Tiles are drawn on a network thread; the UI copies it out under Lock.
public sealed class SkiaCanvas : ITileCanvas
{
    public object Lock { get; } = new object();
    SKBitmap bitmap;

    public int Width => bitmap?.Width ?? 0;
    public int Height => bitmap?.Height ?? 0;

    public void Resize(int width, int height)
    {
        lock (Lock)
        {
            bitmap?.Dispose();
            bitmap = new SKBitmap(new SKImageInfo(width, height, SKColorType.Bgra8888, SKAlphaType.Premul));
            bitmap.Erase(SKColors.Black);
        }
    }

    public void DrawJpeg(byte[] jpeg, int x, int y, int width, int height)
    {
        using var tile = SKBitmap.Decode(jpeg);
        if (tile == null) return;
        lock (Lock)
        {
            if (bitmap == null) return;
            using var c = new SKCanvas(bitmap);
            c.DrawBitmap(tile, new SKRect(x, y, x + width, y + height));
        }
    }

    public SKColor PixelAt(int x, int y) { lock (Lock) return bitmap.GetPixel(x, y); }

    // Copies the picture into a destination BGRA buffer (e.g. an Avalonia WriteableBitmap) of the same size.
    public unsafe bool CopyTo(IntPtr dest, int destRowBytes, int width, int height)
    {
        lock (Lock)
        {
            if (bitmap == null || bitmap.Width != width || bitmap.Height != height) return false;
            var src = (byte*)bitmap.GetPixels();
            int row = width * 4;
            for (int yy = 0; yy < height; yy++)
                Buffer.MemoryCopy(src + (long)yy * bitmap.RowBytes, (byte*)dest + (long)yy * destRowBytes, destRowBytes, row);
            return true;
        }
    }
}
