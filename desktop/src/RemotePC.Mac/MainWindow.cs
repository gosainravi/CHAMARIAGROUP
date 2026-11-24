using System;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Layout;
using Avalonia.Media;
using Avalonia.Threading;
using Newtonsoft.Json.Linq;
using RemotePC.Mac.Platform;
using SSConnect.Core;
using SSConnect.Core.Net;
using SSConnect.Core.Security;
using SSConnect.Core.Session;

namespace RemotePC.Mac;

public class MainWindow : Window
{
    readonly ServerSettings server;
    readonly SignalingClient sig = new();
    readonly CancellationTokenSource cts = new();
    readonly TextBlock idText = new() { Text = "— — —", FontSize = 34, FontWeight = FontWeight.Bold };
    readonly TextBlock pwText = new() { FontSize = 26, FontWeight = FontWeight.Bold, Foreground = Brushes.DarkOrange, FontFamily = new FontFamily("Menlo,Consolas,monospace") };
    readonly TextBlock status = new() { Text = "Connecting to server…", Foreground = Brushes.Gray, Margin = new Thickness(0, 14, 0, 0) };
    readonly TextBlock perms = new() { Foreground = Brushes.DarkOrange, TextWrapping = TextWrapping.Wrap, FontSize = 12 };
    readonly TextBox partnerId = new() { FontSize = 18, Width = 320, Watermark = "123 456 789" };
    readonly TextBox partnerPw = new() { FontSize = 18, Width = 320 };
    readonly Button connect = new() { Content = "Connect", Width = 320, Height = 48, FontSize = 16, FontWeight = FontWeight.Bold, HorizontalContentAlignment = HorizontalAlignment.Center, VerticalContentAlignment = VerticalAlignment.Center };

    string password = Password.Generate();
    string peerId, sessionPassword;
    RelayLink link;
    SecureChannel secure;
    SharedSide shared;
    ViewerSide viewer;
    ViewerWindow viewerWindow;
    ControlBar bar;
    AllowDialog allowDialog;

    public static string FormatId(string id) => id is { Length: 9 } ? $"{id[..3]} {id[3..6]} {id[6..]}" : id;

    public MainWindow(ServerSettings server)
    {
        this.server = server;
        Title = "Remote PC";
        Icon = App.Icon;
        Width = 860; Height = 560; CanResize = false;
        WindowStartupLocation = WindowStartupLocation.CenterScreen;
        connect.Background = new SolidColorBrush(App.Blue);
        connect.Foreground = Brushes.White;
        pwText.Text = password;
        sig.CertificateCheck = (c, e) => CertPin.Validate(c, e, server.Pin);
        Content = BuildLayout();
        connect.Click += (_, _) => Connect();
        sig.Status += s => Dispatcher.UIThread.Post(() => OnStatus(s));
        sig.Message += m => Dispatcher.UIThread.Post(() => OnMessage(m));
        Opened += (_, _) => { RefreshPermissions(); Task.Run(() => sig.RunAsync(server.Uri, cts.Token)); };
        Activated += (_, _) => RefreshPermissions();
    }

    Control BuildLayout()
    {
        var header = new Border
        {
            Background = new SolidColorBrush(App.Blue), Padding = new Thickness(18, 12),
            Child = new StackPanel
            {
                Orientation = Orientation.Horizontal, Spacing = 12,
                Children =
                {
                    new Image { Source = App.Logo, Width = 52, Height = 52 },
                    new StackPanel { VerticalAlignment = VerticalAlignment.Center, Children = {
                        new TextBlock { Text = "Remote PC", FontSize = 24, FontWeight = FontWeight.Bold, Foreground = Brushes.White },
                        new TextBlock { Text = "Secure remote support · control only with your permission", Foreground = new SolidColorBrush(Color.FromRgb(220, 228, 255)) } } }
                }
            }
        };

        var newPw = new Button { Content = "↻ New", Margin = new Thickness(10, 0, 0, 0), VerticalAlignment = VerticalAlignment.Center };
        newPw.Click += (_, _) => { password = Password.Generate(); pwText.Text = password; };
        var grantScreen = new Button { Content = "Allow screen recording…" };
        grantScreen.Click += (_, _) => { MacPermissions.RequestScreenRecording(); MacPermissions.OpenScreenRecordingSettings(); };
        var grantInput = new Button { Content = "Allow control (Accessibility)…" };
        grantInput.Click += (_, _) => MacPermissions.OpenAccessibilitySettings();

        var left = Card("Allow remote control", new StackPanel
        {
            Spacing = 4,
            Children = { Caption("Your ID"), idText, Caption("Password"), new StackPanel { Orientation = Orientation.Horizontal, Children = { pwText, newPw } }, status, perms,
                new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, Margin = new Thickness(0, 6, 0, 0), Children = { grantScreen, grantInput } } }
        });
        var right = Card("Control a remote computer", new StackPanel
        {
            Spacing = 6,
            Children = { Caption("Partner ID"), partnerId, Caption("Password"), partnerPw, new Border { Height = 10 }, connect }
        });
        var cards = new Grid { ColumnDefinitions = new ColumnDefinitions("*,*"), Margin = new Thickness(16) };
        Grid.SetColumn(right, 1);
        cards.Children.Add(left); cards.Children.Add(right);
        return new DockPanel { Children = { header, cards } }.Also(d => DockPanel.SetDock(header, Dock.Top));
    }

    static TextBlock Caption(string t) => new() { Text = t, Foreground = Brushes.Gray, FontSize = 14 };

    static Control Card(string title, Control body) => new Border
    {
        BorderBrush = new SolidColorBrush(Color.FromRgb(216, 219, 226)), BorderThickness = new Thickness(1), CornerRadius = new CornerRadius(12),
        Padding = new Thickness(18), Margin = new Thickness(6),
        Child = new StackPanel { Spacing = 10, Children = { new TextBlock { Text = title, FontSize = 17, FontWeight = FontWeight.Bold }, body } }
    };

    void RefreshPermissions()
    {
        if (!OperatingSystem.IsMacOS()) { perms.Text = ""; return; }
        var missing = new[] { MacPermissions.HasScreenRecording() ? null : "Screen Recording (to share this screen)", MacPermissions.HasAccessibility() ? null : "Accessibility (to be controlled)" }.Where(x => x != null).ToArray();
        perms.Text = missing.Length == 0 ? "" : "Needs permission: " + string.Join(", ", missing) + ". Grant it in System Settings → Privacy & Security, then reopen Remote PC.";
    }

    void OnStatus(string s)
    {
        if (s == "online") { idText.Text = FormatId(sig.MyId); status.Text = "Ready"; }
        else if (s == "offline")
        {
            idText.Text = "— — —";
            status.Text = "Cannot reach Remote PC server — retrying";
            if (peerId != null) EndSession("server");
        }
    }

    void Connect()
    {
        var id = new string((partnerId.Text ?? "").Where(char.IsDigit).ToArray());
        if (id.Length != 9) { Notify("Enter the partner's 9-digit ID."); return; }
        if (string.IsNullOrWhiteSpace(partnerPw.Text)) { Notify("Enter the partner's password."); return; }
        if (sig.MyId == null) { Notify("Not connected to the Remote PC server yet."); return; }
        if (id == sig.MyId) { Notify("That is your own ID."); return; }
        connect.IsEnabled = false; connect.Content = "Connecting…";
        var typed = partnerPw.Text; var me = sig.MyId;
        sessionPassword = typed;
        Task.Run(() => AuthProof.Create(typed, me, id)).ContinueWith(t => sig.SendAsync(new { type = "connect", targetId = id, proof = t.Result }), TaskContinuationOptions.OnlyOnRanToCompletion);
    }

    void ResetConnect() { connect.IsEnabled = true; connect.Content = "Connect"; }

    void OnMessage(JObject m)
    {
        switch ((string)m["type"])
        {
            case "auth-request":
            {
                var reqId = (string)m["reqId"]; var proof = (string)m["proof"]; var from = (string)m["fromId"];
                var mine = password; var me = sig.MyId;
                Task.Run(() => AuthProof.Verify(proof, mine, from, me)).ContinueWith(t =>
                {
                    if (t.Result) Dispatcher.UIThread.Post(() => sessionPassword = mine);
                    sig.SendAsync(new { type = "auth-response", reqId, ok = t.Result });
                }, TaskContinuationOptions.OnlyOnRanToCompletion);
                break;
            }
            case "connect-result":
                if ((bool)m["ok"]) break;
                ResetConnect();
                Notify(Reason((string)m["reason"]));
                break;
            case "session-start":
                StartSession((string)m["role"], (string)m["peerId"], (string)m["sessionId"], TimeSpan.FromMilliseconds((double)m["limitMs"]));
                break;
            case "session-warning":
                var text = $"{Math.Ceiling(TimeSpan.FromMilliseconds((double)m["remainingMs"]).TotalMinutes)} min left in this free session";
                viewerWindow?.ShowNotice(text); bar?.ShowNotice(text);
                break;
            case "session-end":
                EndSession((string)m["reason"]);
                break;
        }
    }

    static string Reason(string r) => r switch
    {
        "offline" => "That ID is not online.",
        "busy" => "That computer is already in a session.",
        "wrong-password" => "Wrong password.",
        "locked" => "Too many wrong passwords. Try again in 5 minutes.",
        _ => "Could not connect."
    };

    async void StartSession(string role, string peer, string sessionId, TimeSpan limit)
    {
        peerId = peer;
        bool isViewer = role == "viewer";
        var pw = sessionPassword;
        if (pw == null || sessionId == null) { _ = sig.SendAsync(new { type = "end" }); EndSession("crypto"); return; }
        status.Text = "Securing connection…";
        var keys = await Task.Run(() => SessionKeys.Derive(pw, sessionId));
        if (peerId != peer || link != null) return;
        secure = new SecureChannel(sig, keys, isViewer);
        link = new RelayLink(secure);
        status.Text = "In session with " + FormatId(peer);
        if (isViewer)
        {
            ResetConnect();
            var canvas = new SkiaCanvas();
            viewer = new ViewerSide(link, canvas);
            viewerWindow = new ViewerWindow(viewer, canvas, peer, limit, () => sig.SendAsync(new { type = "end" }));
            viewerWindow.Show();
        }
        else
        {
            var input = new MacInput();
            bar = new ControlBar(peer, limit, () => shared?.RevokeControl(), () => sig.SendAsync(new { type = "end" }));
            shared = new SharedSide(link, AskUser, granted => Dispatcher.UIThread.Post(() => bar?.SetControlled(granted)),
                input.Apply, MacScreen.Capture, new SkiaCodec());
            bar.Show();
            shared.Start();
        }
    }

    Task<bool> AskUser()
    {
        var tcs = new TaskCompletionSource<bool>();
        Dispatcher.UIThread.Post(() =>
        {
            allowDialog?.Close();
            var dlg = new AllowDialog(peerId);
            allowDialog = dlg;
            dlg.Result.ContinueWith(t => tcs.TrySetResult(t.Result));
            dlg.Closed += (_, _) => { if (allowDialog == dlg) allowDialog = null; };
            dlg.Show(); dlg.Activate();
        });
        return tcs.Task;
    }

    void EndSession(string reason)
    {
        if (peerId == null && link == null) return;
        peerId = null;
        shared?.Dispose(); shared = null;
        allowDialog?.Close(); allowDialog = null;
        viewer?.Dispose(); viewer = null;
        link?.Dispose(); link = null;
        secure?.Detach(); secure = null;
        sessionPassword = null;
        viewerWindow?.CloseFromSession(); viewerWindow = null;
        bar?.Close(); bar = null;
        password = Password.Generate(); pwText.Text = password;
        status.Text = sig.MyId != null ? "Ready" : status.Text;
        ResetConnect();
        var msg = reason switch
        {
            "timeout" => "The free session limit of 40 minutes was reached.",
            "peer-left" => "Your partner disconnected.",
            "server" => "Lost connection to the Remote PC server.",
            "crypto" => "Could not set up the encrypted connection. Please connect again.",
            _ => null
        };
        if (msg != null) Notify(msg);
    }

    void Notify(string text) => new MessageWindow(text).ShowDialog(this);

    protected override void OnClosing(WindowClosingEventArgs e)
    {
        if (peerId != null) sig.SendAsync(new { type = "end" }).Wait(500);
        cts.Cancel();
        base.OnClosing(e);
    }
}

static class Fluent
{
    public static T Also<T>(this T x, Action<T> f) { f(x); return x; }
}

public class MessageWindow : Window
{
    public MessageWindow(string text)
    {
        Title = "Remote PC"; Icon = App.Icon; Width = 420; SizeToContent = SizeToContent.Height; CanResize = false;
        WindowStartupLocation = WindowStartupLocation.CenterOwner;
        var ok = new Button { Content = "OK", HorizontalAlignment = HorizontalAlignment.Right, Width = 90, HorizontalContentAlignment = HorizontalAlignment.Center };
        ok.Click += (_, _) => Close();
        Content = new StackPanel { Margin = new Thickness(20), Spacing = 16, Children = { new TextBlock { Text = text, TextWrapping = TextWrapping.Wrap, FontSize = 15 }, ok } };
    }
}
