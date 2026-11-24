using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;
using Newtonsoft.Json.Linq;
using SIPSorcery.Net;

namespace SSConnect.Core.Net
{
    public class PeerLink : IDisposable
    {
        readonly bool viewer;
        readonly Func<JObject, Task> sendSignal;
        readonly RTCPeerConnection pc;
        readonly List<RTCIceCandidateInit> early = new List<RTCIceCandidateInit>();
        readonly object sync = new object();
        RTCDataChannel screen, control;
        bool remoteSet;

        public event Action<byte[]> ScreenMessage;
        public event Action<string> ControlMessage;
        public event Action<string> StateChanged;

        public PeerLink(bool isViewer, IEnumerable<RTCIceServer> ice, Func<JObject, Task> sendSignal)
        {
            viewer = isViewer;
            this.sendSignal = sendSignal;
            pc = new RTCPeerConnection(new RTCConfiguration { iceServers = ice.ToList() });
            pc.onicecandidate += c =>
            {
                if (c != null) sendSignal(new JObject { ["candidate"] = JObject.Parse(c.toJSON()) });
            };
            pc.onconnectionstatechange += s => StateChanged?.Invoke(s.ToString());
            pc.ondatachannel += Wire;
        }

        void Wire(RTCDataChannel ch)
        {
            if (ch.label == "screen")
            {
                screen = ch;
                ch.onmessage += (c, proto, data) => ScreenMessage?.Invoke(data);
            }
            else if (ch.label == "control")
            {
                control = ch;
                ch.onmessage += (c, proto, data) => ControlMessage?.Invoke(Encoding.UTF8.GetString(data));
            }
        }

        public async Task StartAsync()
        {
            if (!viewer) return;
            Wire(await pc.createDataChannel("control", new RTCDataChannelInit { ordered = true }));
            Wire(await pc.createDataChannel("screen", new RTCDataChannelInit { ordered = false }));
            var offer = pc.createOffer();
            await pc.setLocalDescription(offer);
            await sendSignal(new JObject { ["sdp"] = offer.sdp, ["sdpType"] = "offer" });
        }

        public async Task HandleSignalAsync(JObject d)
        {
            if (d["sdp"] != null)
            {
                var type = (string)d["sdpType"] == "offer" ? RTCSdpType.offer : RTCSdpType.answer;
                pc.setRemoteDescription(new RTCSessionDescriptionInit { type = type, sdp = (string)d["sdp"] });
                List<RTCIceCandidateInit> queued;
                lock (sync) { remoteSet = true; queued = early.ToList(); early.Clear(); }
                foreach (var c in queued) pc.addIceCandidate(c);
                if (type == RTCSdpType.offer)
                {
                    var answer = pc.createAnswer();
                    await pc.setLocalDescription(answer);
                    await sendSignal(new JObject { ["sdp"] = answer.sdp, ["sdpType"] = "answer" });
                }
            }
            else if (d["candidate"] != null)
            {
                var c = d["candidate"].ToObject<RTCIceCandidateInit>();
                bool apply;
                lock (sync) { apply = remoteSet; if (!apply) early.Add(c); }
                if (apply) pc.addIceCandidate(c);
            }
        }

        public void SendScreen(byte[] msg)
        {
            var ch = screen;
            if (ch != null && ch.readyState == RTCDataChannelState.open) ch.send(msg);
        }

        public void SendControl(string json)
        {
            var ch = control;
            if (ch != null && ch.readyState == RTCDataChannelState.open) ch.send(json);
        }

        public void Dispose()
        {
            try { pc.close(); } catch (Exception) { }
        }
    }
}
