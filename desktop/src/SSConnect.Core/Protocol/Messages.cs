using Newtonsoft.Json;
using SSConnect.Core.Input;

namespace SSConnect.Core.Protocol
{
    public class ControlMessage
    {
        [JsonProperty("type")] public string Type;
        [JsonProperty("input", NullValueHandling = NullValueHandling.Ignore)] public InputEvent Input;
        [JsonProperty("quality", NullValueHandling = NullValueHandling.Ignore)] public int? Quality;

        public static string Serialize(ControlMessage m) => JsonConvert.SerializeObject(m);

        public static ControlMessage Parse(string json)
        {
            try { return JsonConvert.DeserializeObject<ControlMessage>(json); }
            catch (JsonException) { return null; }
        }
    }
}
