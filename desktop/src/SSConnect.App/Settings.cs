using System;
using System.IO;
using System.Linq;

namespace SSConnect.App
{
    public class ServerSettings
    {
        public Uri Uri;
        public string Pin;
    }

    public static class Settings
    {
        const string DefaultServer = "wss://15.207.230.218";
        const string DefaultPin = "88:8C:74:1C:8A:F0:85:30:FB:B9:F7:4D:FF:B7:86:BC:F6:2A:C7:6E:6F:AD:25:4E:F4:E1:7F:1C:04:FE:41:D0";

        // Order: --server arg, then server.txt (line 1 = URL, optional "pin <sha256>" line), then the built-in cloud server.
        public static ServerSettings Load(string[] args, string exeDir)
        {
            var arg = args.SkipWhile(a => a != "--server").Skip(1).FirstOrDefault();
            if (arg != null) return new ServerSettings { Uri = new Uri(arg) };

            var file = Path.Combine(exeDir, "server.txt");
            if (File.Exists(file))
            {
                var lines = File.ReadAllLines(file).Select(l => l.Trim()).Where(l => l.Length > 0).ToArray();
                if (lines.Length > 0)
                {
                    var pinLine = lines.Skip(1).FirstOrDefault(l => l.StartsWith("pin ", StringComparison.OrdinalIgnoreCase));
                    return new ServerSettings { Uri = new Uri(lines[0]), Pin = pinLine?.Substring(4).Trim() };
                }
            }
            return new ServerSettings { Uri = new Uri(DefaultServer), Pin = DefaultPin };
        }

        public static bool AllowMulti(string[] args) => args.Contains("--allow-multi");
    }
}
