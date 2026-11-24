using System;
using System.Diagnostics;

namespace SSConnect.Core.Session
{
    public class SessionTimer
    {
        readonly TimeSpan limit;
        readonly Stopwatch sw = Stopwatch.StartNew();

        public SessionTimer(TimeSpan limit) { this.limit = limit; }

        public TimeSpan Remaining
        {
            get
            {
                var r = limit - sw.Elapsed;
                return r < TimeSpan.Zero ? TimeSpan.Zero : r;
            }
        }
    }
}
