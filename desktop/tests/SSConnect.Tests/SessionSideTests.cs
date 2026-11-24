using System;
using System.Collections.Generic;
using System.Drawing;
using System.Threading.Tasks;
using SSConnect.App.Controller;
using SSConnect.Core.Input;
using Xunit;

public class SessionSideTests
{
    static async Task Until(Func<bool> cond, int ms = 5000)
    {
        var end = DateTime.UtcNow.AddMilliseconds(ms);
        while (!cond() && DateTime.UtcNow < end) await Task.Delay(50);
    }

    [Fact]
    public async Task InputIgnoredUntilAllowedThenInjectedOnce()
    {
        var (vl, sl) = LinkPair.Connect();
        var injected = new List<InputEvent>();
        bool allow = false;
        int asked = 0;
        var shared = new SharedSide(sl, () => { asked++; return Task.FromResult(allow); }, _ => { },
            e => { lock (injected) injected.Add(e); }, _ => new Bitmap(128, 128));
        var viewer = new ViewerSide(vl);
        var notices = new List<string>();
        viewer.Notice += n => { lock (notices) notices.Add(n); };
        shared.Start();

        viewer.SendInput(new InputEvent { Kind = "keydown", Vk = 0x41 });
        await Task.Delay(300);
        Assert.Empty(injected);

        viewer.AskControl();
        await Until(() => notices.Count > 0);
        Assert.False(viewer.HasControl);
        Assert.Contains("Partner denied control.", notices);

        allow = true;
        viewer.AskControl();
        await Until(() => viewer.HasControl);
        Assert.True(viewer.HasControl);

        viewer.SendInput(new InputEvent { Kind = "keydown", Vk = 0x41 });
        viewer.SendInput(new InputEvent { Kind = "keyup", Vk = 0x41 });
        await Until(() => injected.Count >= 2);
        await Task.Delay(200);
        Assert.Equal(2, injected.Count);

        shared.RevokeControl();
        await Until(() => !viewer.HasControl);
        Assert.False(viewer.HasControl);
        viewer.SendInput(new InputEvent { Kind = "keydown", Vk = 0x42 });
        await Task.Delay(300);
        Assert.Equal(2, injected.Count);
        Assert.Equal(2, asked);

        shared.Dispose(); viewer.Dispose(); vl.Dispose(); sl.Dispose();
    }

    [Fact]
    public async Task RevokeWhileKeyHeldReleasesIt()
    {
        var (vl, sl) = LinkPair.Connect();
        var injected = new List<InputEvent>();
        var shared = new SharedSide(sl, () => Task.FromResult(true), _ => { },
            e => { lock (injected) injected.Add(e); }, _ => new Bitmap(64, 64));
        var viewer = new ViewerSide(vl);
        shared.Start();
        viewer.AskControl();
        await Until(() => viewer.HasControl);
        viewer.SendInput(new InputEvent { Kind = "keydown", Vk = 0x11 });
        await Until(() => injected.Count == 1);
        shared.RevokeControl();
        await Until(() => injected.Count == 2);
        Assert.Equal("keyup", injected[1].Kind);
        Assert.Equal(0x11, injected[1].Vk);
        shared.Dispose(); viewer.Dispose(); vl.Dispose(); sl.Dispose();
    }

    [Fact]
    public async Task AllowAfterSessionEndedIsIgnored()
    {
        var (vl, sl) = LinkPair.Connect();
        var answer = new TaskCompletionSource<bool>();
        int controlChanges = 0;
        var shared = new SharedSide(sl, () => answer.Task, _ => controlChanges++, _ => { }, _ => new Bitmap(64, 64));
        var viewer = new ViewerSide(vl);
        shared.Start();
        viewer.AskControl();
        await Task.Delay(500);
        shared.Dispose();
        answer.SetResult(true);
        await Task.Delay(300);
        Assert.Equal(0, controlChanges);
        Assert.False(viewer.HasControl);
        viewer.Dispose(); vl.Dispose(); sl.Dispose();
    }

    [Fact]
    public async Task CursorLeftOutOfPictureWhileControlled()
    {
        var (vl, sl) = LinkPair.Connect();
        var withCursor = new List<bool>();
        var shared = new SharedSide(sl, () => Task.FromResult(true), _ => { }, _ => { },
            cursor => { lock (withCursor) withCursor.Add(cursor); return new Bitmap(64, 64); });
        var viewer = new ViewerSide(vl);
        shared.Start();
        await Until(() => { lock (withCursor) return withCursor.Count > 0; });
        lock (withCursor) Assert.True(withCursor[0]);
        viewer.AskControl();
        await Until(() => viewer.HasControl);
        lock (withCursor) withCursor.Clear();
        await Until(() => { lock (withCursor) return withCursor.Count > 2; });
        lock (withCursor) Assert.All(withCursor, c => Assert.False(c));
        shared.Dispose(); viewer.Dispose(); vl.Dispose(); sl.Dispose();
    }

    [Fact]
    public async Task ViewerReceivesFrame()
    {
        var (vl, sl) = LinkPair.Connect();
        var shared = new SharedSide(sl, () => Task.FromResult(false), _ => { }, _ => { }, _ => new Bitmap(128, 128));
        var viewer = new ViewerSide(vl);
        var got = new TaskCompletionSource<bool>();
        viewer.FrameChanged += () => got.TrySetResult(true);
        shared.Start();
        await Task.WhenAny(got.Task, Task.Delay(10000));
        Assert.True(got.Task.IsCompleted, "no frame received");
        Assert.Equal(128, viewer.Frame.Width);
        shared.Dispose(); viewer.Dispose(); vl.Dispose(); sl.Dispose();
    }
}
