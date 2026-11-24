using System;
using System.IO;
using System.Net.WebSockets;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace SSConnect.Core.Net
{
    // One WebSocket to the Remote PC server: JSON text for signaling, binary frames for relayed session traffic.
    public class SignalingClient : IBinaryChannel
    {
        ClientWebSocket ws;
        readonly SemaphoreSlim sendLock = new SemaphoreSlim(1, 1);

        public event Action<JObject> Message;
        public event Action<byte[]> BinaryMessage;
        public event Action<string> Status;
        public string MyId { get; private set; }

        public async Task RunAsync(Uri server, CancellationToken ct)
        {
            while (!ct.IsCancellationRequested)
            {
                Status?.Invoke("connecting");
                try
                {
                    ws = new ClientWebSocket();
                    await ws.ConnectAsync(server, ct);
                    await ReceiveLoop(ct);
                }
                catch (OperationCanceledException) { break; }
                catch (Exception) { }
                MyId = null;
                Status?.Invoke("offline");
                try { await Task.Delay(3000, ct); } catch (OperationCanceledException) { break; }
            }
        }

        async Task ReceiveLoop(CancellationToken ct)
        {
            var buf = new byte[64 * 1024];
            var ms = new MemoryStream();
            while (ws.State == WebSocketState.Open)
            {
                ms.SetLength(0);
                WebSocketReceiveResult r;
                do
                {
                    r = await ws.ReceiveAsync(new ArraySegment<byte>(buf), ct);
                    if (r.MessageType == WebSocketMessageType.Close) return;
                    ms.Write(buf, 0, r.Count);
                } while (!r.EndOfMessage);

                if (r.MessageType == WebSocketMessageType.Binary)
                {
                    BinaryMessage?.Invoke(ms.ToArray());
                    continue;
                }
                JObject msg;
                try { msg = JObject.Parse(Encoding.UTF8.GetString(ms.GetBuffer(), 0, (int)ms.Length)); }
                catch (JsonException) { continue; }
                if ((string)msg["type"] == "welcome")
                {
                    MyId = (string)msg["id"];
                    Status?.Invoke("online");
                }
                Message?.Invoke(msg);
            }
        }

        public Task SendAsync(object msg) =>
            Send(Encoding.UTF8.GetBytes(JsonConvert.SerializeObject(msg)), WebSocketMessageType.Text);

        public Task SendBinaryAsync(byte[] data) => Send(data, WebSocketMessageType.Binary);

        async Task Send(byte[] bytes, WebSocketMessageType type)
        {
            var s = ws;
            if (s == null || s.State != WebSocketState.Open) return;
            await sendLock.WaitAsync();
            try { await s.SendAsync(new ArraySegment<byte>(bytes), type, true, CancellationToken.None); }
            catch (WebSocketException) { } // connection dropped; RunAsync reconnects and the session ends
            catch (ObjectDisposedException) { }
            finally { sendLock.Release(); }
        }
    }
}
