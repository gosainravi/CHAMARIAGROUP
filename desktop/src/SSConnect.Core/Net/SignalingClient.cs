using System;
using System.Net.WebSockets;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace SSConnect.Core.Net
{
    public class SignalingClient
    {
        ClientWebSocket ws;
        readonly SemaphoreSlim sendLock = new SemaphoreSlim(1, 1);

        public event Action<JObject> Message;
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
            while (ws.State == WebSocketState.Open)
            {
                var sb = new StringBuilder();
                WebSocketReceiveResult r;
                do
                {
                    r = await ws.ReceiveAsync(new ArraySegment<byte>(buf), ct);
                    if (r.MessageType == WebSocketMessageType.Close) return;
                    sb.Append(Encoding.UTF8.GetString(buf, 0, r.Count));
                } while (!r.EndOfMessage);

                JObject msg;
                try { msg = JObject.Parse(sb.ToString()); } catch (JsonException) { continue; }
                if ((string)msg["type"] == "welcome")
                {
                    MyId = (string)msg["id"];
                    Status?.Invoke("online");
                }
                Message?.Invoke(msg);
            }
        }

        public async Task SendAsync(object msg)
        {
            var s = ws;
            if (s == null || s.State != WebSocketState.Open) return;
            var bytes = Encoding.UTF8.GetBytes(JsonConvert.SerializeObject(msg));
            await sendLock.WaitAsync();
            try { await s.SendAsync(new ArraySegment<byte>(bytes), WebSocketMessageType.Text, true, CancellationToken.None); }
            finally { sendLock.Release(); }
        }
    }
}
