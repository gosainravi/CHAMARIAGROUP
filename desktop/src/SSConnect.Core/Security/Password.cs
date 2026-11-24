using System.Security.Cryptography;
using System.Text;

namespace SSConnect.Core.Security
{
    public static class Password
    {
        const string Alphabet = "abcdefghjkmnpqrstuvwxyz23456789";

        public static string Generate()
        {
            var sb = new StringBuilder(6);
            using (var rng = RandomNumberGenerator.Create())
            {
                var b = new byte[1];
                while (sb.Length < 6)
                {
                    rng.GetBytes(b);
                    // reject values that would bias the modulo
                    if (b[0] >= 256 - 256 % Alphabet.Length) continue;
                    sb.Append(Alphabet[b[0] % Alphabet.Length]);
                }
            }
            return sb.ToString();
        }

        public static string Normalize(string s) => (s ?? "").Replace(" ", "").Trim().ToLowerInvariant();

        public static bool Matches(string expected, string typed)
        {
            var t = Normalize(typed);
            return t.Length > 0 && t == Normalize(expected);
        }
    }
}
