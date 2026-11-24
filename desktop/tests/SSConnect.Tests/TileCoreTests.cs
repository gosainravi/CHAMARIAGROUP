using System.Drawing;
using SSConnect.Core.Platform;
using SSConnect.Core.Screen;
using Xunit;

// Platform-neutral change detection on raw BGRA frames (runs on Windows and on the Mac build machine).
public class TileCoreTests
{
    static Frame White(int w, int h)
    {
        var f = new Frame(w, h);
        for (int i = 0; i < f.Bgra.Length; i++) f.Bgra[i] = 0xFF;
        return f;
    }

    static void SetBlack(Frame f, int x, int y)
    {
        int o = (y * f.Width + x) * 4;
        f.Bgra[o] = f.Bgra[o + 1] = f.Bgra[o + 2] = 0;
    }

    [Fact]
    public void DetectsOnlyTheChangedTileOnRawFrames()
    {
        var d = new TileDiffer(64);
        Assert.Equal(12, d.Changed(White(200, 130), false).Count);
        var f = White(200, 130); SetBlack(f, 70, 10);
        Assert.Equal(new[] { new Rectangle(64, 0, 64, 64) }, d.Changed(f, false));
        var same = White(200, 130); SetBlack(same, 70, 10);
        Assert.Empty(d.Changed(same, false));
    }

    [Fact]
    public void FullFrameMergesToOneRectPerRow()
    {
        var merged = TileDiffer.MergeRows(new TileDiffer(64).Changed(White(200, 130), false));
        Assert.Equal(3, merged.Count);
        Assert.All(merged, r => Assert.Equal(200, r.Width));
    }
}
