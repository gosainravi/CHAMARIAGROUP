using System.IO;
using SSConnect.Core;
using Xunit;

public class SettingsTests
{
    static string TempDir() =>
        Directory.CreateDirectory(Path.Combine(Path.GetTempPath(), "ssc-settings-" + Path.GetRandomFileName())).FullName;

    [Fact]
    public void ArgWinsOverFile()
    {
        var dir = TempDir();
        File.WriteAllText(Path.Combine(dir, "server.txt"), "ws://from-file:1\n");
        Assert.Equal("ws://1.2.3.4:9000/", Settings.Load(new[] { "--server", "ws://1.2.3.4:9000" }, dir).Uri.ToString());
        Assert.Equal("ws://from-file:1/", Settings.Load(new string[0], dir).Uri.ToString());
    }

    [Fact]
    public void DefaultsToCloudServerWithPin()
    {
        var s = Settings.Load(new string[0], TempDir());
        Assert.Equal("wss://15.207.230.218/", s.Uri.ToString());
        Assert.Equal("88:8C:74:1C:8A:F0:85:30:FB:B9:F7:4D:FF:B7:86:BC:F6:2A:C7:6E:6F:AD:25:4E:F4:E1:7F:1C:04:FE:41:D0", s.Pin);
    }

    [Fact]
    public void FileCanSetPin()
    {
        var dir = TempDir();
        File.WriteAllText(Path.Combine(dir, "server.txt"), "wss://10.0.0.5\npin AA:BB\n");
        var s = Settings.Load(new string[0], dir);
        Assert.Equal("wss://10.0.0.5/", s.Uri.ToString());
        Assert.Equal("AA:BB", s.Pin);
    }

    [Fact]
    public void CustomServerWithoutPinUsesNormalValidation()
    {
        Assert.Null(Settings.Load(new[] { "--server", "wss://example.org" }, TempDir()).Pin);
    }

    [Fact]
    public void AllowMultiFlag()
    {
        Assert.True(Settings.AllowMulti(new[] { "--allow-multi" }));
        Assert.False(Settings.AllowMulti(new string[0]));
    }
}
