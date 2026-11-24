using System;
using System.Security.Cryptography;
using System.Threading;
using System.Threading.Tasks;
using SSConnect.Core.Security;

namespace SSConnect.Core.Net
{
    // End-to-end encryption of every relayed frame: AES-256-CBC, then HMAC-SHA256 over the whole frame.
    // Frame: [version][direction][sequence:8][iv:16][ciphertext][mac:32]. Wrong key, tampering, replay,
    // reordering or a frame reflected back to its sender are all dropped.
    public class SecureChannel : IBinaryChannel
    {
        const byte Version = 0x45;
        const byte FromViewer = 1, FromShared = 2;
        const int Header = 1 + 1 + 8 + 16, MacLen = 32;

        readonly IBinaryChannel inner;
        readonly byte[] sendEnc, sendMac, recvEnc, recvMac;
        readonly byte sendDir, recvDir;
        readonly SemaphoreSlim sendOrder = new SemaphoreSlim(1, 1);
        readonly RandomNumberGenerator rng = RandomNumberGenerator.Create();
        long sendSeq, recvSeq;

        public event Action<byte[]> BinaryMessage;

        public SecureChannel(IBinaryChannel inner, SessionKeys keys, bool isViewer)
        {
            this.inner = inner;
            sendDir = isViewer ? FromViewer : FromShared;
            recvDir = isViewer ? FromShared : FromViewer;
            sendEnc = isViewer ? keys.ViewerToSharedEnc : keys.SharedToViewerEnc;
            sendMac = isViewer ? keys.ViewerToSharedMac : keys.SharedToViewerMac;
            recvEnc = isViewer ? keys.SharedToViewerEnc : keys.ViewerToSharedEnc;
            recvMac = isViewer ? keys.SharedToViewerMac : keys.ViewerToSharedMac;
            inner.BinaryMessage += OnFrame;
        }

        public async Task SendBinaryAsync(byte[] plain)
        {
            // Sequence numbers must hit the wire in order, so numbering and sending happen under one lock.
            await sendOrder.WaitAsync();
            try
            {
                var iv = new byte[16];
                rng.GetBytes(iv);
                byte[] ct;
                using (var aes = NewAes(sendEnc))
                using (var enc = aes.CreateEncryptor(sendEnc, iv))
                    ct = enc.TransformFinalBlock(plain, 0, plain.Length);
                var frame = new byte[Header + ct.Length + MacLen];
                frame[0] = Version;
                frame[1] = sendDir;
                WriteInt64(frame, 2, ++sendSeq);
                Buffer.BlockCopy(iv, 0, frame, 10, 16);
                Buffer.BlockCopy(ct, 0, frame, Header, ct.Length);
                using (var h = new HMACSHA256(sendMac))
                    Buffer.BlockCopy(h.ComputeHash(frame, 0, Header + ct.Length), 0, frame, Header + ct.Length, MacLen);
                await inner.SendBinaryAsync(frame);
            }
            finally { sendOrder.Release(); }
        }

        void OnFrame(byte[] f)
        {
            if (f == null || f.Length < Header + 16 + MacLen || f[0] != Version || f[1] != recvDir) return;
            int ctLen = f.Length - Header - MacLen;
            byte[] mac;
            using (var h = new HMACSHA256(recvMac)) mac = h.ComputeHash(f, 0, Header + ctLen);
            var given = new byte[MacLen];
            Buffer.BlockCopy(f, Header + ctLen, given, 0, MacLen);
            if (!FixedTime.Equals(mac, given)) return;
            long seq = ReadInt64(f, 2);
            if (seq <= recvSeq) return;
            byte[] plain;
            try
            {
                var iv = new byte[16];
                Buffer.BlockCopy(f, 10, iv, 0, 16);
                using (var aes = NewAes(recvEnc))
                using (var dec = aes.CreateDecryptor(recvEnc, iv))
                    plain = dec.TransformFinalBlock(f, Header, ctLen);
            }
            catch (CryptographicException) { return; }
            recvSeq = seq;
            BinaryMessage?.Invoke(plain);
        }

        static Aes NewAes(byte[] key)
        {
            var aes = Aes.Create();
            aes.KeySize = 256; aes.Mode = CipherMode.CBC; aes.Padding = PaddingMode.PKCS7; aes.Key = key;
            return aes;
        }

        static void WriteInt64(byte[] b, int o, long v) { for (int i = 7; i >= 0; i--) { b[o + i] = (byte)v; v >>= 8; } }
        static long ReadInt64(byte[] b, int o) { long v = 0; for (int i = 0; i < 8; i++) v = (v << 8) | b[o + i]; return v; }

        public void Detach() => inner.BinaryMessage -= OnFrame;
    }
}
