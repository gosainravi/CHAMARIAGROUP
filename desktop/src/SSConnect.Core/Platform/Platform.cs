using System;
using System.Drawing;

namespace SSConnect.Core.Platform
{
    // A captured screen: 32-bit BGRA pixels, row stride = Width * 4. Native optionally carries the
    // platform image it came from (GDI+ Bitmap, Skia bitmap) so the codec can avoid a copy.
    public sealed class Frame : IDisposable
    {
        public readonly int Width, Height;
        public readonly byte[] Bgra;
        public IDisposable Native;

        public Frame(int width, int height, byte[] bgra = null, IDisposable native = null)
        {
            Width = width; Height = height;
            Bgra = bgra ?? new byte[width * height * 4];
            Native = native;
        }

        public void Dispose() { Native?.Dispose(); Native = null; }
    }

    public interface IImageCodec
    {
        byte[] EncodeJpeg(Frame frame, Rectangle region, int quality);
    }

    // Viewer-side surface that composes received JPEG tiles into the remote screen picture.
    public interface ITileCanvas
    {
        int Width { get; }
        int Height { get; }
        void Resize(int width, int height);
        void DrawJpeg(byte[] jpeg, int x, int y, int width, int height);
    }
}
