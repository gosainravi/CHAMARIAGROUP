using System;
using System.Linq;
using Avalonia;
using SSConnect.Core;

namespace RemotePC.Mac;

static class Program
{
    [STAThread]
    static int Main(string[] args)
    {
        var server = Settings.Load(args, AppContext.BaseDirectory);
        if (args.Contains("--smoke")) return Smoke.Run(server).GetAwaiter().GetResult();
        App.Server = server;
        return BuildAvaloniaApp().StartWithClassicDesktopLifetime(args);
    }

    public static AppBuilder BuildAvaloniaApp() =>
        AppBuilder.Configure<App>().UsePlatformDetect().WithInterFont();
}
