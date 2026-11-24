using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using SSConnect.Core.Net;
using SSConnect.Core.Security;
using Xunit;

public class SecureChannelTests
{
    static (SecureChannel viewer, SecureChannel shared, MemoryChannel rawViewer, MemoryChannel rawShared) Pair(string pwViewer = "ab3k9m", string pwShared = "ab3k9m")
    {
        var (a, b) = MemoryChannel.Pair();
        var kv = SessionKeys.Derive(pwViewer, "session-1");
        var ks = SessionKeys.Derive(pwShared, "session-1");
        return (new SecureChannel(a, kv, isViewer: true), new SecureChannel(b, ks, isViewer: false), a, b);
    }

    static async Task<List<byte[]>> Collect(SecureChannel ch, int count, int ms = 2000)
    {
        var got = new List<byte[]>();
        ch.BinaryMessage += m => { lock (got) got.Add(m); };
        var end = DateTime.UtcNow.AddMilliseconds(ms);
        while (DateTime.UtcNow < end) { lock (got) if (got.Count >= count) break; await Task.Delay(20); }
        await Task.Delay(100);
        return got;
    }

    [Fact]
    public async Task RoundTripsBothDirections()
    {
        var (v, s, _, _) = Pair();
        var atShared = Collect(s, 1);
        var atViewer = Collect(v, 1);
        await v.SendBinaryAsync(new byte[] { 2, 1, 2, 3 });
        await s.SendBinaryAsync(new byte[] { 1, 9, 9 });
        Assert.Equal(new byte[] { 2, 1, 2, 3 }, (await atShared)[0]);
        Assert.Equal(new byte[] { 1, 9, 9 }, (await atViewer)[0]);
    }

    [Fact]
    public async Task ServerSeesOnlyCiphertext()
    {
        var (a, b) = MemoryChannel.Pair();
        var seen = new List<byte[]>();
        b.BinaryMessage += m => { lock (seen) seen.Add(m); };
        var v = new SecureChannel(a, SessionKeys.Derive("ab3k9m", "s"), true);
        var secret = System.Text.Encoding.UTF8.GetBytes("\u0002{\"type\":\"input\",\"key\":\"PASSWORD123\"}");
        await v.SendBinaryAsync(secret);
        await Task.Delay(200);
        var wire = System.Text.Encoding.UTF8.GetString(seen[0]);
        Assert.DoesNotContain("PASSWORD123", wire);
        Assert.DoesNotContain("input", wire);
    }

    [Fact]
    public async Task WrongPasswordDecryptsNothing()
    {
        var (v, s, _, _) = Pair("ab3k9m", "zzzzzz");
        var atShared = Collect(s, 1, 500);
        await v.SendBinaryAsync(new byte[] { 2, 1 });
        Assert.Empty(await atShared);
    }

    [Fact]
    public async Task TamperedFrameIsDropped()
    {
        var (a, b) = MemoryChannel.Pair();
        var keys = SessionKeys.Derive("ab3k9m", "s");
        var s = new SecureChannel(b, keys, isViewer: false);
        var atShared = Collect(s, 1, 500);
        // capture a real frame from the viewer side, flip one byte, and replay it into the shared side
        var (a2, b2) = MemoryChannel.Pair();
        byte[] wire = null;
        b2.BinaryMessage += m => wire = m;
        await new SecureChannel(a2, keys, isViewer: true).SendBinaryAsync(new byte[] { 2, 7 });
        await Task.Delay(200);
        wire[wire.Length - 40] ^= 0x01;
        await a.SendBinaryAsync(wire);
        Assert.Empty(await atShared);
    }

    [Fact]
    public async Task ReplayedFrameIsDropped()
    {
        var (a, b) = MemoryChannel.Pair();
        var keys = SessionKeys.Derive("ab3k9m", "s");
        var s = new SecureChannel(b, keys, isViewer: false);
        var atShared = Collect(s, 3, 800);
        var (a2, b2) = MemoryChannel.Pair();
        var wires = new List<byte[]>();
        b2.BinaryMessage += m => { lock (wires) wires.Add(m); };
        await new SecureChannel(a2, keys, isViewer: true).SendBinaryAsync(new byte[] { 2, 7 });
        await Task.Delay(200);
        await a.SendBinaryAsync(wires[0]);
        await a.SendBinaryAsync(wires[0]);
        Assert.Single(await atShared);
    }

    [Fact]
    public async Task FrameCannotBeReflectedBackToSender()
    {
        var (a, b) = MemoryChannel.Pair();
        var keys = SessionKeys.Derive("ab3k9m", "s");
        var v = new SecureChannel(a, keys, isViewer: true);
        var atViewer = Collect(v, 1, 500);
        byte[] wire = null;
        var (a2, b2) = MemoryChannel.Pair();
        b2.BinaryMessage += m => wire = m;
        await new SecureChannel(a2, keys, isViewer: true).SendBinaryAsync(new byte[] { 2, 7 });
        await Task.Delay(200);
        await b.SendBinaryAsync(wire);  // a viewer-sent frame delivered to a viewer
        Assert.Empty(await atViewer);
    }
}

public class AuthProofTests
{
    [Fact]
    public void ProofMatchesOnlyWithSamePasswordAndIds()
    {
        var p = AuthProof.Create(" AB3 K9M ", "111111111", "222222222");
        Assert.True(AuthProof.Verify(p, "ab3k9m", "111111111", "222222222"));
        Assert.False(AuthProof.Verify(p, "ab3k9n", "111111111", "222222222"));
        Assert.False(AuthProof.Verify(p, "ab3k9m", "333333333", "222222222"));
        Assert.False(AuthProof.Verify("garbage", "ab3k9m", "111111111", "222222222"));
        Assert.DoesNotContain("ab3k9m", p);
    }
}
