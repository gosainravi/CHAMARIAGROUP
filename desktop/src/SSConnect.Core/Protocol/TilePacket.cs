using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Linq;
using SSConnect.Core.Screen;

namespace SSConnect.Core.Protocol
{
    public static class TilePacket
    {
        const byte Kind = 1;
        const int Header = 7, PerTile = 12;

        public static List<byte[]> Encode(int screenW, int screenH, IList<Tile> tiles, int maxBytes = 60000)
        {
            var msgs = new List<byte[]>();
            var batch = new List<Tile>();
            int size = Header;
            foreach (var t in tiles)
            {
                int need = PerTile + t.Jpeg.Length;
                if (batch.Count > 0 && size + need > maxBytes)
                {
                    msgs.Add(Write(screenW, screenH, batch));
                    batch.Clear();
                    size = Header;
                }
                batch.Add(t);
                size += need;
            }
            if (batch.Count > 0) msgs.Add(Write(screenW, screenH, batch));
            return msgs;
        }

        static byte[] Write(int sw, int sh, List<Tile> tiles)
        {
            using (var ms = new MemoryStream())
            using (var w = new BinaryWriter(ms))
            {
                w.Write(Kind); w.Write((ushort)sw); w.Write((ushort)sh); w.Write((ushort)tiles.Count);
                foreach (var t in tiles)
                {
                    w.Write((ushort)t.X); w.Write((ushort)t.Y); w.Write((ushort)t.W); w.Write((ushort)t.H);
                    w.Write(t.Jpeg.Length); w.Write(t.Jpeg);
                }
                return ms.ToArray();
            }
        }

        public static bool TryDecode(byte[] msg, out int screenW, out int screenH, out List<Tile> tiles)
        {
            screenW = screenH = 0;
            tiles = null;
            if (msg == null || msg.Length < Header) return false;
            try
            {
                using (var r = new BinaryReader(new MemoryStream(msg)))
                {
                    if (r.ReadByte() != Kind) return false;
                    screenW = r.ReadUInt16(); screenH = r.ReadUInt16();
                    int n = r.ReadUInt16();
                    var list = new List<Tile>(n);
                    for (int i = 0; i < n; i++)
                    {
                        var t = new Tile { X = r.ReadUInt16(), Y = r.ReadUInt16(), W = r.ReadUInt16(), H = r.ReadUInt16() };
                        int len = r.ReadInt32();
                        if (len < 0 || len > msg.Length) return false;
                        t.Jpeg = r.ReadBytes(len);
                        if (t.Jpeg.Length != len) return false;
                        list.Add(t);
                    }
                    tiles = list;
                    return true;
                }
            }
            catch (EndOfStreamException) { return false; }
        }
    }

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
}
