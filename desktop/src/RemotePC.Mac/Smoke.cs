using System;
using System.Drawing;
using System.Threading;
using System.Threading.Tasks;
using RemotePC.Mac.Platform;
using SSConnect.Core;
using SSConnect.Core.Net;
using SSConnect.Core.Platform;
using SSConnect.Core.Security;

namespace RemotePC.Mac;

// Headless self-test for build machines: real server, real pin, real crypto, real Skia codec. Exit 0 = pass.
static class Smoke
{
    public static async Task<int> Run(ServerSettings server)
    {
        try
        {
            Console.WriteLine($"server: {server.Uri}");
            var sig = new SignalingClient { CertificateCheck = (c, e) => CertPin.Validate(c, e, server.Pin) };
            var online = new TaskCompletionSource<bool>();
            sig.Status += s => { if (s == "online") online.TrySetResult(true); };
            using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(30));
            _ = sig.RunAsync(server.Uri, cts.Token);
            if (await Task.WhenAny(online.Task, Task.Delay(20000)) != online.Task) return Fail("no ID from server within 20 s");
            Console.WriteLine($"PASS server: got ID {sig.MyId} over pinned TLS");

            var proof = AuthProof.Create("ab3k9m", "111111111", sig.MyId);
            if (!AuthProof.Verify(proof, "AB3 K9M", "111111111", sig.MyId)) return Fail("auth proof");
            var keys = SessionKeys.Derive("ab3k9m", "smoke-session");
            var (a, b) = LoopChannel.Pair();
            var viewer = new SecureChannel(a, keys, true);
            var shared = new SecureChannel(b, keys, false);
            var got = new TaskCompletionSource<byte[]>();
            shared.BinaryMessage += m => got.TrySetResult(m);
            await viewer.SendBinaryAsync(new byte[] { 2, 42 });
            if (await Task.WhenAny(got.Task, Task.Delay(3000)) != got.Task || got.Task.Result[1] != 42) return Fail("encryption round trip");
            Console.WriteLine("PASS crypto: proof + AES-256/HMAC round trip");

            var frame = new Frame(128, 96);
            for (int i = 0; i < frame.Bgra.Length; i += 4) { frame.Bgra[i] = 255; frame.Bgra[i + 3] = 255; } // blue
            var jpeg = new SkiaCodec().EncodeJpeg(frame, new Rectangle(0, 0, 64, 48), 70);
            var canvas = new SkiaCanvas();
            canvas.Resize(128, 96);
            canvas.DrawJpeg(jpeg, 0, 0, 64, 48);
            var px = canvas.PixelAt(10, 10);
            if (jpeg.Length < 100 || px.Blue < 200) return Fail($"codec (jpeg {jpeg.Length} bytes, pixel B={px.Blue})");
            Console.WriteLine($"PASS codec: JPEG {jpeg.Length} bytes decoded correctly");

            Console.WriteLine($"platform: {(OperatingSystem.IsMacOS() ? "macOS " + Environment.OSVersion.Version : "not macOS — native capture/input skipped")}");
            if (OperatingSystem.IsMacOS())
            {
                Console.WriteLine($"info: screen capture permission = {MacPermissions.HasScreenRecording()}, accessibility = {MacPermissions.HasAccessibility()}");
                Console.WriteLine($"info: main display {MacScreen.DisplaySizePoints()}");
            }
            Console.WriteLine("SMOKE OK");
            cts.Cancel();
            return 0;
        }
        catch (Exception ex) { return Fail(ex.ToString()); }
    }

    static int Fail(string why) { Console.WriteLine("SMOKE FAIL: " + why); return 1; }

    sealed class LoopChannel : IBinaryChannel
    {
        public LoopChannel Peer;
        public event Action<byte[]> BinaryMessage;
        public Task SendBinaryAsync(byte[] data) { Task.Run(() => Peer.BinaryMessage?.Invoke(data)); return Task.CompletedTask; }
        public static (LoopChannel, LoopChannel) Pair() { var x = new LoopChannel(); var y = new LoopChannel { Peer = x }; x.Peer = y; return (x, y); }
    }
}
