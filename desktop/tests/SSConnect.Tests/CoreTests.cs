using SSConnect.Core.Input;
using SSConnect.Core.Protocol;
using SSConnect.Core.Security;
using Xunit;

public class PasswordTests
{
    [Fact]
    public void GeneratesSixAllowedChars()
    {
        var p = Password.Generate();
        Assert.Equal(6, p.Length);
        Assert.Matches("^[abcdefghjkmnpqrstuvwxyz23456789]{6}$", p);
    }

    [Fact]
    public void NormalizesInput()
    {
        Assert.True(Password.Matches("ab3k9m", " AB3 K9M "));
        Assert.False(Password.Matches("ab3k9m", "ab3k9n"));
        Assert.False(Password.Matches("ab3k9m", ""));
        Assert.False(Password.Matches("ab3k9m", null));
    }
}

public class CoordMapTests
{
    [Fact]
    public void RoundTripsAcrossResolutions()
    {
        var n = CoordMap.ToNormalized(400, 300, 800, 600);
        var p = CoordMap.ToPixels(n.X, n.Y, 2880, 1620);
        Assert.Equal(1440, p.X);
        Assert.Equal(810, p.Y);
    }

    [Fact]
    public void LetterboxKeepsAspectAndCenters()
    {
        var r = CoordMap.Letterbox(new System.Drawing.Size(1920, 1080), new System.Drawing.Size(1000, 1000));
        Assert.Equal(new System.Drawing.Rectangle(0, 218, 1000, 563), r);
        var tall = CoordMap.Letterbox(new System.Drawing.Size(1000, 1000), new System.Drawing.Size(1600, 800));
        Assert.Equal(new System.Drawing.Rectangle(400, 0, 800, 800), tall);
    }

    [Fact]
    public void ClampsOutside()
    {
        var p = CoordMap.ToPixels(1.4f, -0.2f, 1920, 1080);
        Assert.Equal(1919, p.X);
        Assert.Equal(0, p.Y);
    }
}

public class InputGateTests
{
    static InputEvent K(string kind, int vk) => new InputEvent { Kind = kind, Vk = vk };

    [Fact]
    public void DropsUntilGranted()
    {
        var g = new InputGate();
        Assert.False(g.Accept(K("keydown", 0x41)));
        g.Grant();
        Assert.True(g.Accept(K("keydown", 0x41)));
    }

    [Fact]
    public void RevokeReleasesHeldKeys()
    {
        var g = new InputGate();
        g.Grant();
        g.Accept(K("keydown", 0x11));
        g.Accept(new InputEvent { Kind = "down", Button = 0 });
        var release = g.Revoke();
        Assert.False(g.Granted);
        Assert.Contains(release, e => e.Kind == "keyup" && e.Vk == 0x11);
        Assert.Contains(release, e => e.Kind == "up" && e.Button == 0);
        Assert.False(g.Accept(K("keydown", 0x41)));
    }

    [Fact]
    public void KeyUpClearsHeld()
    {
        var g = new InputGate();
        g.Grant();
        g.Accept(K("keydown", 0x41));
        g.Accept(K("keyup", 0x41));
        Assert.Empty(g.Revoke());
    }

    [Fact]
    public void RevokeDuringInjectionStillReleasesTheKey()
    {
        var g = new InputGate();
        g.Grant();
        var injected = new System.Collections.Generic.List<string>();
        var inInject = new System.Threading.ManualResetEventSlim();
        var t = System.Threading.Tasks.Task.Run(() => g.AcceptAndRun(K("keydown", 0x11), e =>
        {
            inInject.Set();
            System.Threading.Thread.Sleep(200);
            lock (injected) injected.Add(e.Kind);
        }));
        inInject.Wait();
        g.RevokeAndRun(e => { lock (injected) injected.Add(e.Kind); });
        t.Wait();
        Assert.Equal(new[] { "keydown", "keyup" }, injected);
    }

    [Fact]
    public void AcceptAndRunSkipsWhenNotGranted()
    {
        var g = new InputGate();
        bool ran = false;
        Assert.False(g.AcceptAndRun(K("keydown", 1), _ => ran = true));
        Assert.False(ran);
    }

    [Fact]
    public void RejectsUnknownKind()
    {
        var g = new InputGate();
        g.Grant();
        Assert.False(g.Accept(K("explode", 1)));
        Assert.False(g.Accept(null));
    }
}

public class ControlMessageTests
{
    [Fact]
    public void RoundTripsInput()
    {
        var json = ControlMessage.Serialize(new ControlMessage { Type = "input", Input = new InputEvent { Kind = "move", X = 0.5f, Y = 0.25f } });
        var m = ControlMessage.Parse(json);
        Assert.Equal("input", m.Type);
        Assert.Equal(0.25f, m.Input.Y);
    }

    [Fact]
    public void GarbageParsesToNull()
    {
        Assert.Null(ControlMessage.Parse("{not json"));
    }
}
