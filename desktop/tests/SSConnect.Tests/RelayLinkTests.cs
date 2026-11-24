using System;
using System.Threading.Tasks;
using SSConnect.Core.Net;
using Xunit;

// In-memory stand-in for the server connection: whatever one side sends, the other side receives.
public class MemoryChannel : IBinaryChannel
{
    public MemoryChannel Peer;
    public event Action<byte[]> BinaryMessage;
    Task delivery = Task.CompletedTask;
    readonly object sync = new object();

    // Delivered asynchronously but in order, like a WebSocket.
    public Task SendBinaryAsync(byte[] data)
    {
        var copy = (byte[])data.Clone();
        lock (sync) delivery = delivery.ContinueWith(_ => Peer.BinaryMessage?.Invoke(copy), TaskScheduler.Default);
        return Task.CompletedTask;
    }
    public static (MemoryChannel a, MemoryChannel b) Pair()
    {
        var a = new MemoryChannel();
        var b = new MemoryChannel { Peer = a };
        a.Peer = b;
        return (a, b);
    }
}

public static class LinkPair
{
    public static (RelayLink viewer, RelayLink shared) Connect()
    {
        var (a, b) = MemoryChannel.Pair();
        return (new RelayLink(a), new RelayLink(b));
    }
}

public class RelayLinkTests
{
    [Fact]
    public async Task ControlAndScreenRoundTrip()
    {
        var (viewer, shared) = LinkPair.Connect();
        var control = new TaskCompletionSource<string>();
        var screen = new TaskCompletionSource<byte[]>();
        shared.ControlMessage += s => control.TrySetResult(s);
        viewer.ScreenMessage += b => screen.TrySetResult(b);

        viewer.SendControl("{\"type\":\"ask-control\"}");
        var tile = new byte[50000]; tile[0] = 1; tile[49999] = 7;
        await shared.SendScreenAsync(tile);

        Assert.Equal("{\"type\":\"ask-control\"}", await control.Task);
        var got = await screen.Task;
        Assert.Equal(50000, got.Length);
        Assert.Equal(7, got[49999]);
    }

    [Fact]
    public async Task IgnoresUnknownFramesAndStopsAfterDispose()
    {
        var (a, b) = MemoryChannel.Pair();
        var link = new RelayLink(b);
        int events = 0;
        link.ControlMessage += _ => events++;
        link.ScreenMessage += _ => events++;
        await a.SendBinaryAsync(new byte[0]);
        await a.SendBinaryAsync(new byte[] { 9, 1, 2 });
        await Task.Delay(100);
        Assert.Equal(0, events);
        link.Dispose();
        await a.SendBinaryAsync(new byte[] { 2, (byte)'x' });
        await Task.Delay(100);
        Assert.Equal(0, events);
    }
}
