using Avalonia;
using Avalonia.Controls;
using Avalonia.Controls.ApplicationLifetimes;
using Avalonia.Media;
using Avalonia.Media.Imaging;
using Avalonia.Styling;
using Avalonia.Themes.Fluent;
using SSConnect.Core;

namespace RemotePC.Mac;

public class App : Application
{
    public static ServerSettings Server;
    public static readonly Color Blue = Color.FromRgb(79, 110, 247);
    public static Bitmap Logo { get; } = new Bitmap(typeof(App).Assembly.GetManifestResourceStream("RemotePC.Logo.png"));
    public static WindowIcon Icon { get; } = new WindowIcon(typeof(App).Assembly.GetManifestResourceStream("RemotePC.Logo.png"));

    public override void Initialize()
    {
        Styles.Add(new FluentTheme());
        RequestedThemeVariant = ThemeVariant.Light;
    }

    public override void OnFrameworkInitializationCompleted()
    {
        if (ApplicationLifetime is IClassicDesktopStyleApplicationLifetime desktop)
            desktop.MainWindow = new MainWindow(Server);
        base.OnFrameworkInitializationCompleted();
    }
}
