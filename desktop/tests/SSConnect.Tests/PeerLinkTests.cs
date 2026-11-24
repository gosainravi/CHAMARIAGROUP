using System.Threading.Tasks;
using SIPSorcery.Net;
using SSConnect.Core.Net;
using Xunit;

public static class LinkPair
{
    public static async Task<(PeerLink viewer, PeerLink shared)> Connect()
    {
        PeerLink viewer = null, shared = null;
        var ice = new RTCIceServer[0];
        viewer = new PeerLink(true, ice, d => shared.HandleSignalAsync(d));
        shared = new PeerLink(false, ice, d => viewer.HandleSignalAsync(d));
        var open = new TaskCompletionSource<bool>();
        viewer.StateChanged += s => { if (s == "connected") open.TrySetResult(true); };
        await shared.StartAsync();
        await viewer.StartAsync();
        var done = await Task.WhenAny(open.Task, Task.Delay(15000));
        Assert.True(done == open.Task, "peer link did not connect");
        await Task.Delay(500);
        return (viewer, shared);
    }
}

public class PeerLinkTests
{
    [Fact]
    public async Task ViewerAndSharedExchangeOnBothChannels()
    {
        var (viewer, shared) = await LinkPair.Connect();
        var gotControl = new TaskCompletionSource<string>();
        var gotScreen = new TaskCompletionSource<int>();
        shared.ControlMessage += s => gotControl.TrySetResult(s);
        viewer.ScreenMessage += b => gotScreen.TrySetResult(b.Length);

        viewer.SendControl("{\"type\":\"ask-control\"}");
        shared.SendScreen(new byte[50000]);

        await Task.WhenAny(Task.WhenAll(gotControl.Task, gotScreen.Task), Task.Delay(10000));
        Assert.True(gotControl.Task.IsCompleted, "control message not received");
        Assert.True(gotScreen.Task.IsCompleted, "screen message not received");
        Assert.Equal("{\"type\":\"ask-control\"}", await gotControl.Task);
        Assert.Equal(50000, await gotScreen.Task);
        viewer.Dispose();
        shared.Dispose();
    }
}
