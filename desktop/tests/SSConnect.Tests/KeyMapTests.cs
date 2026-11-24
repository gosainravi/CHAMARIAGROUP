using SSConnect.Core.Input;
using Xunit;

public class KeyMapTests
{
    [Theory]
    [InlineData(0x41, 0x00)] // A
    [InlineData(0x43, 0x08)] // C
    [InlineData(0x56, 0x09)] // V
    [InlineData(0x30, 0x1D)] // 0
    [InlineData(0x0D, 0x24)] // Enter -> Return
    [InlineData(0x08, 0x33)] // Backspace -> Delete
    [InlineData(0x2E, 0x75)] // Delete -> Forward delete
    [InlineData(0x25, 0x7B)] // Left arrow
    [InlineData(0x70, 0x7A)] // F1
    public void MapsWindowsKeysToMacKeys(int vk, int mac)
    {
        Assert.Equal(mac, KeyMap.VkToMac(vk));
    }

    [Fact]
    public void ControlActsAsCommandOnTheMac()
    {
        // A Windows user pressing Ctrl+C on a Mac expects Copy (Cmd+C).
        Assert.Equal(0x37, KeyMap.VkToMac(0x11));
        Assert.Equal(0x3B, KeyMap.VkToMac(0x5B)); // Windows key -> Control
    }

    [Fact]
    public void UnknownKeysReturnMinusOne()
    {
        Assert.Equal(-1, KeyMap.VkToMac(0xFE));
    }

    [Fact]
    public void EveryMappedMacKeyRoundTripsBackToItsWindowsKey()
    {
        for (int vk = 0; vk < 256; vk++)
        {
            int mac = KeyMap.VkToMac(vk);
            if (mac >= 0) Assert.Equal(vk, KeyMap.MacToVk(mac));
        }
    }
}
