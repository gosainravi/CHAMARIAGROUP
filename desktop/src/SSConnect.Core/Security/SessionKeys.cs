using System;
using System.Security.Cryptography;
using System.Text;

namespace SSConnect.Core.Security
{
    // Both PCs know the session password; the relay server does not. Keys are derived from it per session,
    // with a deliberately slow KDF so guessing the 6-character password offline is expensive.
    public class SessionKeys
    {
        const int Iterations = 100000;

        public byte[] ViewerToSharedEnc, ViewerToSharedMac, SharedToViewerEnc, SharedToViewerMac;

        public static SessionKeys Derive(string password, string sessionId)
        {
            var salt = Encoding.UTF8.GetBytes("RemotePC/e2e/v1|" + sessionId);
            byte[] okm;
            using (var kdf = new Rfc2898DeriveBytes(Encoding.UTF8.GetBytes(Password.Normalize(password)), salt, Iterations, HashAlgorithmName.SHA256))
                okm = kdf.GetBytes(128);
            return new SessionKeys
            {
                ViewerToSharedEnc = Slice(okm, 0), ViewerToSharedMac = Slice(okm, 32),
                SharedToViewerEnc = Slice(okm, 64), SharedToViewerMac = Slice(okm, 96)
            };
        }

        static byte[] Slice(byte[] a, int offset)
        {
            var r = new byte[32];
            Buffer.BlockCopy(a, offset, r, 0, 32);
            return r;
        }
    }

    // Proves knowledge of the password to the other PC without sending the password through the server.
    public static class AuthProof
    {
        const int Iterations = 100000;

        public static string Create(string password, string fromId, string toId)
        {
            var salt = Encoding.UTF8.GetBytes("RemotePC/auth/v1|" + fromId + "|" + toId);
            using (var kdf = new Rfc2898DeriveBytes(Encoding.UTF8.GetBytes(Password.Normalize(password)), salt, Iterations, HashAlgorithmName.SHA256))
                return Convert.ToBase64String(kdf.GetBytes(32));
        }

        public static bool Verify(string proof, string password, string fromId, string toId)
        {
            byte[] given;
            try { given = Convert.FromBase64String(proof ?? ""); } catch (FormatException) { return false; }
            var expected = Convert.FromBase64String(Create(password, fromId, toId));
            return given.Length == expected.Length && FixedTime.Equals(given, expected);
        }
    }

    public static class FixedTime
    {
        public static bool Equals(byte[] a, byte[] b)
        {
            if (a.Length != b.Length) return false;
            int diff = 0;
            for (int i = 0; i < a.Length; i++) diff |= a[i] ^ b[i];
            return diff == 0;
        }
    }
}
