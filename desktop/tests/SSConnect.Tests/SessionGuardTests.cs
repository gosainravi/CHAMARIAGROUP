using SSConnect.Core.Session;
using Xunit;

public class SessionGuardTests
{
    [Fact]
    public void AcceptsOnlyCurrentSession()
    {
        var g = new SessionGuard();
        Assert.False(g.Accepts("s1"));
        g.Start("s1");
        Assert.True(g.Accepts("s1"));
        Assert.False(g.Accepts("old"));
        Assert.False(g.Accepts(null));
        g.End();
        Assert.False(g.Accepts("s1"));
        g.Start("s2");
        Assert.False(g.Accepts("s1"));
    }
}
