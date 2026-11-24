using System;
using System.Net;
using System.Net.WebSockets;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using SSConnect.Core.Net;
using Xunit;

public class SignalingClientTests
{
    // Minimal WebSocket server: sends a welcome, then echoes every binary frame back.
    static async Task EchoServer(HttpListener listener, CancellationToken ct)
    {
        var ctx = await listener.GetContextAsync();
        var ws = (await ctx.AcceptWebSocketAsync(null)).WebSocket;
        var welcome = Encoding.UTF8.GetBytes("{\"type\":\"welcome\",\"id\":\"123456789\"}");
        await ws.SendAsync(new ArraySegment<byte>(welcome), WebSocketMessageType.Text, true, ct);
        var buf = new byte[256 * 1024];
        while (ws.State == WebSocketState.Open && !ct.IsCancellationRequested)
        {
            int n = 0; WebSocketReceiveResult r;
            do { r = await ws.ReceiveAsync(new ArraySegment<byte>(buf, n, buf.Length - n), ct); n += r.Count; } while (!r.EndOfMessage);
            if (r.MessageType == WebSocketMessageType.Close) break;
            await ws.SendAsync(new ArraySegment<byte>(buf, 0, n), r.MessageType, true, ct);
        }
    }

    [Fact]
    public async Task SendsAndReceivesLargeBinaryFrames()
    {
        int port = 18000 + new Random().Next(1000);
        var listener = new HttpListener();
        listener.Prefixes.Add($"http://localhost:{port}/");
        listener.Start();
        var cts = new CancellationTokenSource(15000);
        _ = EchoServer(listener, cts.Token);

        var client = new SignalingClient();
        var online = new TaskCompletionSource<bool>();
        var echoed = new TaskCompletionSource<byte[]>();
        client.Status += s => { if (s == "online") online.TrySetResult(true); };
        client.BinaryMessage += b => echoed.TrySetResult(b);
        _ = client.RunAsync(new Uri($"ws://localhost:{port}/"), cts.Token);

        await Task.WhenAny(online.Task, Task.Delay(5000));
        Assert.Equal("123456789", client.MyId);
        var frame = new byte[150000]; frame[0] = 1; frame[149999] = 42;
        await client.SendBinaryAsync(frame);
        await Task.WhenAny(echoed.Task, Task.Delay(5000));
        Assert.True(echoed.Task.IsCompleted, "binary frame not echoed");
        var got = await echoed.Task;
        Assert.Equal(150000, got.Length);
        Assert.Equal(42, got[149999]);
        cts.Cancel();
        listener.Stop();
    }
}
