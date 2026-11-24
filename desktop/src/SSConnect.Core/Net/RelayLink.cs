using System;
using System.Text;
using System.Threading.Tasks;

namespace SSConnect.Core.Net
{
    public interface ISessionLink
    {
        event Action<byte[]> ScreenMessage;
        event Action<string> ControlMessage;
        Task SendScreenAsync(byte[] msg);
        void SendControl(string json);
    }

    public interface IBinaryChannel
    {
        event Action<byte[]> BinaryMessage;
        Task SendBinaryAsync(byte[] data);
    }

    // Session traffic relayed by the Remote PC server over the existing secure WebSocket.
    // Frame byte 0: 1 = screen tiles (TilePacket already starts with 1), 2 = control JSON.
    public class RelayLink : ISessionLink, IDisposable
    {
        const byte Screen = 1, Control = 2;
        readonly IBinaryChannel channel;

        public event Action<byte[]> ScreenMessage;
        public event Action<string> ControlMessage;

        public RelayLink(IBinaryChannel channel)
        {
            this.channel = channel;
            channel.BinaryMessage += OnFrame;
        }

        void OnFrame(byte[] f)
        {
            if (f == null || f.Length == 0) return;
            if (f[0] == Screen) ScreenMessage?.Invoke(f);
            else if (f[0] == Control) ControlMessage?.Invoke(Encoding.UTF8.GetString(f, 1, f.Length - 1));
        }

        public Task SendScreenAsync(byte[] msg) =>
            msg != null && msg.Length > 0 && msg[0] == Screen ? channel.SendBinaryAsync(msg) : Task.CompletedTask;

        public void SendControl(string json)
        {
            var body = Encoding.UTF8.GetBytes(json);
            var frame = new byte[body.Length + 1];
            frame[0] = Control;
            Buffer.BlockCopy(body, 0, frame, 1, body.Length);
            _ = channel.SendBinaryAsync(frame);
        }

        public void Dispose() => channel.BinaryMessage -= OnFrame;
    }
}
