using System;
using System.Collections;
using System.Collections.Generic;
using UnityEngine;

namespace PoorWords
{
    public sealed class DialogueDirector : MonoBehaviour
    {
        [Serializable] class Line { public string id; public string text; }
        [Serializable] class Script { public Line[] lines; }
        readonly Dictionary<string, string> text = new Dictionary<string, string>();
        readonly List<string> transcript = new List<string>();
        AudioSource voice;
        Coroutine routine;
        bool storyPlaying;
        float nextOptional;
        string lastId;
        public string Subtitle { get; private set; } = "";
        public bool Muted { get; set; }
        public bool Busy => routine != null;
        public IReadOnlyList<string> Transcript => transcript;
        void Awake() {
            voice = gameObject.AddComponent<AudioSource>();
            voice.spatialBlend = .75f; voice.minDistance = 1.8f; voice.maxDistance = 12;
            var data = Resources.Load<TextAsset>("Dialogue");
            if (data) foreach (var line in JsonUtility.FromJson<Script>(data.text).lines) text[line.id] = line.text;
        }
        public void Story(params string[] ids) {
            StopCurrent(); storyPlaying = true;
            routine = StartCoroutine(Play(ids));
        }
        public bool Optional(string id) {
            if (storyPlaying || Busy || Time.time < nextOptional) return false;
            nextOptional = Time.time + 6;
            routine = StartCoroutine(Play(new[] { id })); return true;
        }
        public void Replay() { if (!string.IsNullOrEmpty(lastId) && !storyPlaying) { StopCurrent(); routine = StartCoroutine(Play(new[] { lastId })); } }
        void StopCurrent() { if (routine != null) StopCoroutine(routine); routine = null; voice.Stop(); Subtitle = ""; }
        IEnumerator Play(string[] ids) {
            foreach (var id in ids) {
                if (!text.TryGetValue(id, out var line)) { Debug.LogError("Missing dialogue " + id); continue; }
                lastId = id; Subtitle = line;
                transcript.Add("IRIS  /  " + line);
                Debug.Log("[Dialogue] " + id + ": " + line);
                var clip = Resources.Load<AudioClip>("Voice/" + id);
                voice.clip = clip; voice.mute = Muted;
                if (clip) voice.Play();
                float duration = clip ? clip.length : Mathf.Max(2.5f, line.Length / 14f);
                // Keep the subtitle for the full recording, even if voice is muted.
                for (float t = 0; t < duration + .3f; t += Time.unscaledDeltaTime) { voice.mute = Muted; yield return null; }
                Subtitle = ""; yield return new WaitForSecondsRealtime(.25f);
            }
            storyPlaying = false; routine = null;
        }
    }
}
