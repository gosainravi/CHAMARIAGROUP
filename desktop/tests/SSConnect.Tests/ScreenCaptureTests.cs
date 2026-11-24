using SSConnect.App.Win32;
using Xunit;

public class ScreenCaptureTests
{
    [Fact]
    public void CapturesPrimaryAtReportedSize()
    {
        var size = ScreenCapture.PrimarySize();
        Assert.True(size.Width > 0 && size.Height > 0);
        using (var bmp = ScreenCapture.CapturePrimary())
        {
            Assert.Equal(size.Width, bmp.Width);
            Assert.Equal(size.Height, bmp.Height);
        }
    }
}
