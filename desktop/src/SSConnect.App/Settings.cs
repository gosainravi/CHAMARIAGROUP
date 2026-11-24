using System;
using System.IO;
using System.Linq;

namespace SSConnect.App
{
    public static class Settings
    {
        public static Uri ServerUri(string[] args, string exeDir)
        {
            var arg = args.SkipWhile(a => a != "--server").Skip(1).FirstOrDefault();
            var file = Path.Combine(exeDir, "server.txt");
            var s = arg ?? (File.Exists(file) ? File.ReadAllText(file).Trim() : "ws://localhost:8080");
            return new Uri(s);
        }

        public static bool AllowMulti(string[] args) => args.Contains("--allow-multi");
    }
}
