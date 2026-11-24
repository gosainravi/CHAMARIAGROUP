using System;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using SSConnect.Core.Net;
using Xunit;

public class CertPinTests
{
    static X509Certificate2 SelfSigned()
    {
        using (var key = ECDsa.Create(ECCurve.NamedCurves.nistP256))
        {
            var req = new CertificateRequest("CN=test", key, HashAlgorithmName.SHA256);
            return req.CreateSelfSigned(DateTimeOffset.UtcNow.AddDays(-1), DateTimeOffset.UtcNow.AddDays(1));
        }
    }

    static string Fingerprint(X509Certificate2 c)
    {
        using (var sha = SHA256.Create()) return BitConverter.ToString(sha.ComputeHash(c.RawData)).Replace("-", ":");
    }

    [Fact]
    public void MatchesSha256FingerprintInAnyFormat()
    {
        var cert = SelfSigned();
        var fp = Fingerprint(cert);
        Assert.True(CertPin.Matches(cert, fp));
        Assert.True(CertPin.Matches(cert, fp.Replace(":", "").ToLowerInvariant()));
        Assert.True(CertPin.Matches(cert, "  " + fp.Replace(":", " ") + " "));
    }

    [Fact]
    public void RejectsOtherCertificateAndEmptyPin()
    {
        var cert = SelfSigned();
        Assert.False(CertPin.Matches(cert, Fingerprint(SelfSigned())));
        Assert.False(CertPin.Matches(cert, ""));
        Assert.False(CertPin.Matches(null, Fingerprint(cert)));
    }

    [Fact]
    public void PinnedServerIgnoresChainErrorsButRequiresMatch()
    {
        var cert = SelfSigned();
        var fp = Fingerprint(cert);
        Assert.True(CertPin.Validate(cert, System.Net.Security.SslPolicyErrors.RemoteCertificateChainErrors, fp));
        Assert.False(CertPin.Validate(SelfSigned(), System.Net.Security.SslPolicyErrors.None, fp));
        Assert.True(CertPin.Validate(cert, System.Net.Security.SslPolicyErrors.None, null));
        Assert.False(CertPin.Validate(cert, System.Net.Security.SslPolicyErrors.RemoteCertificateChainErrors, null));
    }
}
