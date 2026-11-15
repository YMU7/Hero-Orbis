using System;
using System.Collections.Generic;

namespace PoorWords
{
    public enum Chapter { Muted, VoiceReleased, RibbonRemoved, NightEstablished, BridgeCrossed, DoorCreated, Rescued }
    public enum Tool { None, Hammer, Charcoal, RealSword, DrawnSword }

    // Engine-independent state: every successful transition is ordered and idempotent.
    public sealed class PuzzleState
    {
        public Chapter Chapter { get; private set; }
        public bool Started { get; private set; }
        public bool SwordDrawn { get; private set; }
        public bool SwordDocked { get; private set; }
        public bool BellRung { get; private set; }
        public bool[] Letters { get; } = { true, true, true, true, true, true };
        public event Action<Chapter> Changed;
        public readonly HashSet<string> Attempts = new HashSet<string>();
        public string Word {
            get { var s = ""; for (int i = 0; i < 6; i++) if (Letters[i]) s += "KNIGHT"[i]; return s; }
        }
        public void Start() { Started = true; }
        public bool BreakSilence(Tool tool) => tool == Tool.Hammer && Advance(Chapter.Muted);
        public bool DrawSword() {
            if (!Started || Chapter != Chapter.VoiceReleased || SwordDrawn) return false;
            SwordDrawn = true; return true;
        }
        public bool CutRibbon(Tool tool) {
            if (!SwordDrawn || tool != Tool.DrawnSword) return false;
            return Advance(Chapter.VoiceReleased);
        }
        public bool ToggleLetter(int index) {
            if (!Started || index < 0 || index >= 6 || Chapter >= Chapter.NightEstablished) return false;
            Letters[index] = !Letters[index];
            return true;
        }
        public bool ResolveNight() => Word == "NIGHT" && Advance(Chapter.RibbonRemoved);
        public bool DockSword(Tool tool) {
            if (!Started || Chapter != Chapter.NightEstablished || tool != Tool.DrawnSword || SwordDocked) return false;
            SwordDocked = true; return true;
        }
        public bool LowerBridge() => SwordDocked && Advance(Chapter.NightEstablished);
        public bool MakeDoor(bool perimeter, bool handle) => perimeter && handle && Advance(Chapter.BridgeCrossed);
        public bool OpenDoor() => Advance(Chapter.DoorCreated);
        public void RingBell() { BellRung = true; }
        public bool FirstAttempt(string id) => Attempts.Add(id);
        bool Advance(Chapter from) {
            if (!Started || Chapter != from) return false;
            Chapter = (Chapter)((int)from + 1); Changed?.Invoke(Chapter); return true;
        }
    }

    // Coverage, rather than artistic quality. Shared by desktop rays and VR charcoal contact.
    public sealed class TraceCoverage
    {
        readonly HashSet<int> bins = new HashSet<int>();
        public int Count => bins.Count;
        public bool Complete {
            get { for (int side = 0; side < 4; side++) { int n = 0;
                for (int i = 0; i < 12; i++) if (bins.Contains(side * 12 + i)) n++;
                if (n < 7) return false;
            } return true; }
        }
        public float Progress {
            get {
                float sum = 0;
                for (int side = 0; side < 4; side++) {
                    int count = 0;
                    for (int i = 0; i < 12; i++) if (bins.Contains(side * 12 + i)) count++;
                    sum += Math.Min(1f, count / 7f);
                }
                return sum / 4f;
            }
        }
        public void Add(float x, float y) {
            // Coordinates normalized to [-.5, .5], with generous edge tolerance.
            if (Math.Abs(y - .5f) < .12f) AddSide(0, x);
            if (Math.Abs(x - .5f) < .12f) AddSide(1, y);
            if (Math.Abs(y + .5f) < .12f) AddSide(2, x);
            if (Math.Abs(x + .5f) < .12f) AddSide(3, y);
        }
        void AddSide(int side, float v) {
            if (v < -.64f || v > .64f) return;
            bins.Add(side * 12 + Math.Max(0, Math.Min(11, (int)((v + .5f) * 12))));
        }
        public void Clear() => bins.Clear();
    }
}
