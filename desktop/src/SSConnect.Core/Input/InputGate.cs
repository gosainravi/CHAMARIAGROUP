using System.Collections.Generic;
using System.Linq;

namespace SSConnect.Core.Input
{
    public class InputEvent
    {
        public string Kind;
        public float X;
        public float Y;
        public int Button;
        public int Delta;
        public int Vk;
    }

    public class InputGate
    {
        readonly HashSet<int> keys = new HashSet<int>();
        readonly HashSet<int> buttons = new HashSet<int>();
        readonly object sync = new object();

        public bool Granted { get; private set; }

        public void Grant() { lock (sync) Granted = true; }

        public IList<InputEvent> Revoke()
        {
            lock (sync)
            {
                Granted = false;
                var release = keys.Select(k => new InputEvent { Kind = "keyup", Vk = k })
                    .Concat(buttons.Select(b => new InputEvent { Kind = "up", Button = b }))
                    .ToList();
                keys.Clear();
                buttons.Clear();
                return release;
            }
        }

        // Accept + inject under one lock so a concurrent Revoke cannot release a key before it is pressed.
        public bool AcceptAndRun(InputEvent e, System.Action<InputEvent> run)
        {
            lock (sync)
            {
                if (!Accept(e)) return false;
                run(e);
                return true;
            }
        }

        public void RevokeAndRun(System.Action<InputEvent> run)
        {
            lock (sync)
                foreach (var e in Revoke()) run(e);
        }

        public bool Accept(InputEvent e)
        {
            lock (sync)
            {
                if (!Granted || e == null) return false;
                switch (e.Kind)
                {
                    case "keydown": keys.Add(e.Vk); break;
                    case "keyup": keys.Remove(e.Vk); break;
                    case "down": buttons.Add(e.Button); break;
                    case "up": buttons.Remove(e.Button); break;
                    case "move":
                    case "wheel": break;
                    default: return false;
                }
                return true;
            }
        }
    }
}
