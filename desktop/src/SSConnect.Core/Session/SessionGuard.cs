namespace SSConnect.Core.Session
{
    // Drops signaling messages that belong to any session other than the current one.
    public class SessionGuard
    {
        string current;

        public void Start(string sessionId) => current = sessionId;
        public void End() => current = null;
        public bool Accepts(string sessionId) => current != null && sessionId == current;
    }
}
