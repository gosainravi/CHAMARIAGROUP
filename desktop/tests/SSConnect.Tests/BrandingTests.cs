using SSConnect.App.UI;
using Xunit;

public class BrandingTests
{
    [Fact]
    public void LogoAndIconAreEmbedded()
    {
        Assert.Equal(256, Branding.Logo.Width);
        Assert.True(Branding.Icon.Width > 0);
    }
}
