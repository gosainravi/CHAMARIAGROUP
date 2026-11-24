using System.IO;
using SSConnect.App;
using Xunit;

public class SettingsTests
{
    [Fact]
    public void ArgWinsOverFile()
    {
        var dir = Directory.CreateDirectory(Path.Combine(Path.GetTempPath(), "ssc-settings-" + Path.GetRandomFileName())).FullName;
        File.WriteAllText(Path.Combine(dir, "server.txt"), "ws://from-file:1\n");
        Assert.Equal("ws://1.2.3.4:9000/", Settings.ServerUri(new[] { "--server", "ws://1.2.3.4:9000" }, dir).ToString());
        Assert.Equal("ws://from-file:1/", Settings.ServerUri(new string[0], dir).ToString());
    }

    [Fact]
    public void DefaultsToLocalhost()
    {
        var dir = Directory.CreateDirectory(Path.Combine(Path.GetTempPath(), "ssc-settings-" + Path.GetRandomFileName())).FullName;
        Assert.Equal("ws://localhost:8080/", Settings.ServerUri(new string[0], dir).ToString());
    }

    [Fact]
    public void AllowMultiFlag()
    {
        Assert.True(Settings.AllowMulti(new[] { "--allow-multi" }));
        Assert.False(Settings.AllowMulti(new string[0]));
    }
}
