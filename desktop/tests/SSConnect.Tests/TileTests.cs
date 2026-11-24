using System.Drawing;
using System.Linq;
using SSConnect.Core.Protocol;
using SSConnect.Core.Screen;
using Xunit;

public class TileTests
{
    static Bitmap Solid(int w, int h, Color c)
    {
        var b = new Bitmap(w, h);
        using (var g = Graphics.FromImage(b)) g.Clear(c);
        return b;
    }

    [Fact]
    public void FirstFrameAllTilesThenOnlyChanged()
    {
        var d = new TileDiffer(64);
        Assert.Equal(4 * 3, d.Changed(Solid(200, 130, Color.White), false).Count);
        var f2 = Solid(200, 130, Color.White);
        f2.SetPixel(70, 10, Color.Black);
        var ch = d.Changed(f2, false);
        Assert.Single(ch);
        Assert.Equal(new Rectangle(64, 0, 64, 64), ch[0]);
        var f3 = Solid(200, 130, Color.White);
        f3.SetPixel(70, 10, Color.Black);
        Assert.Empty(d.Changed(f3, false));
    }

    [Fact]
    public void ForceAllReturnsEveryTile()
    {
        var d = new TileDiffer(64);
        d.Changed(Solid(200, 130, Color.White), false);
        Assert.Equal(12, d.Changed(Solid(200, 130, Color.White), true).Count);
    }

    [Fact]
    public void EdgeTilesAreCropped()
    {
        var all = new TileDiffer(64).Changed(Solid(200, 130, Color.White), false);
        Assert.Contains(new Rectangle(192, 128, 8, 2), all);
    }

    [Fact]
    public void PacketRoundTripAndSplit()
    {
        var big = new byte[40000];
        var tiles = Enumerable.Range(0, 3).Select(i => new Tile { X = i * 64, Y = 0, W = 64, H = 64, Jpeg = big }).ToList();
        var msgs = TilePacket.Encode(1920, 1080, tiles, 60000);
        Assert.Equal(3, msgs.Count);
        var decoded = msgs.SelectMany(m =>
        {
            Assert.True(TilePacket.TryDecode(m, out var w, out var h, out var t));
            Assert.Equal(1920, w);
            Assert.Equal(1080, h);
            return t;
        }).ToList();
        Assert.Equal(new[] { 0, 64, 128 }, decoded.Select(t => t.X));
        Assert.Equal(40000, decoded[2].Jpeg.Length);
    }

    [Fact]
    public void RejectsGarbage()
    {
        Assert.False(TilePacket.TryDecode(new byte[] { 0x01, 0x02 }, out _, out _, out _));
        Assert.False(TilePacket.TryDecode(new byte[] { 0x09, 0, 0, 0, 0, 0, 0 }, out _, out _, out _));
    }

    [Fact]
    public void JpegTileRoundTrips()
    {
        var src = Solid(128, 128, Color.Red);
        var jpeg = JpegCodec.Encode(src, new Rectangle(64, 64, 64, 64), 70);
        using (var img = JpegCodec.Decode(jpeg))
        {
            Assert.Equal(64, img.Width);
            Assert.True(img.GetPixel(10, 10).R > 200);
        }
    }
}
