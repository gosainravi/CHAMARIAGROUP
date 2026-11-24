using System;
using System.Linq;
using System.Net.Security;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;

namespace SSConnect.Core.Net
{
    // The Remote PC server uses its own certificate on a bare IP, so we trust exactly that certificate instead of a CA chain.
    public static class CertPin
    {
        public static bool Matches(X509Certificate cert, string pin)
        {
            if (cert == null) return false;
            var expected = Normalize(pin);
            if (expected.Length != 64) return false;
            using (var sha = SHA256.Create())
            {
                var actual = BitConverter.ToString(sha.ComputeHash(cert.GetRawCertData())).Replace("-", "");
                return string.Equals(actual, expected, StringComparison.OrdinalIgnoreCase);
            }
        }

        public static bool Validate(X509Certificate cert, SslPolicyErrors errors, string pin) =>
            pin != null ? Matches(cert, pin) : errors == SslPolicyErrors.None;

        static string Normalize(string pin) =>
            new string((pin ?? "").Where(Uri.IsHexDigit).ToArray());
    }
}
