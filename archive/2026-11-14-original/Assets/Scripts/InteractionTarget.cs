using UnityEngine;

namespace PoorWords
{
    public enum TargetKind { Start, Hint, Assist, Replay, ResetTools, Bell, Plaque, Ribbon, Knight, Letter, Board, Bridge, Crank, Frame, Handle, Painting }
    public sealed class InteractionTarget : MonoBehaviour
    {
        public TargetKind kind;
        public int index;
        public string label;
        public Vector2 drawSize = Vector2.one;
        public Renderer highlight;
        Color original;
        bool lit;
        public void Configure(TargetKind type, string text, int slot = 0) {
            kind = type; label = text; index = slot;
            highlight = GetComponentInChildren<Renderer>();
            if (highlight) original = highlight.material.color;
        }
        public void Hover(bool active) {
            if (active == lit || !highlight) return;
            lit = active;
            highlight.material.color = active ? Color.Lerp(original, new Color(1f, .8f, .35f), .3f) : original;
        }
    }
}
