using UnityEngine;

namespace PoorWords
{
    public sealed class Pickup : MonoBehaviour
    {
        public Tool tool;
        public string displayName;
        public Vector3 tipOffset;
        public Vector3 home;
        public Quaternion homeRotation;
        public Rigidbody body;
        public bool Held { get; private set; }
        public bool Locked { get; private set; }
        float lostTime;
        InteractionTarget previousContact;
        public Vector3 Tip => transform.TransformPoint(tipOffset);
        public void Setup(Tool value, string title, Vector3 tip) {
            tool = value; displayName = title; tipOffset = tip;
            home = transform.position; homeRotation = transform.rotation;
            body = gameObject.AddComponent<Rigidbody>(); body.mass = .35f;
            body.collisionDetectionMode = CollisionDetectionMode.ContinuousSpeculative;
        }
        public bool Take() {
            if (Locked || Held) return false;
            Held = true; body.isKinematic = true; previousContact = null; return true;
        }
        public void Release() {
            Held = false; if (!Locked) body.isKinematic = false; previousContact = null;
        }
        public void LockAt(Vector3 position, Quaternion rotation) {
            Held = false; Locked = true; body.isKinematic = true;
            transform.SetPositionAndRotation(position, rotation);
        }
        public void ReturnHome() {
            if (Locked || Held) return;
            body.isKinematic = true;
            transform.SetPositionAndRotation(home, homeRotation);
            body.isKinematic = false; lostTime = 0;
        }
        void Update() {
            if (!Locked && !Held) {
                if (transform.position.y < .15f || Mathf.Abs(transform.position.x) > 4.7f || Mathf.Abs(transform.position.z) > 4.7f) {
                    lostTime += Time.deltaTime; if (lostTime > 3f) ReturnHome();
                } else lostTime = 0;
            }
            if (!Held || !GalleryGame.Instance || !GalleryGame.Instance.IsXR) return;
            var hits = Physics.OverlapSphere(Tip, .07f);
            InteractionTarget target = null;
            foreach (var hit in hits) {
                if (hit.transform.IsChildOf(transform)) continue;
                var t = hit.GetComponentInParent<InteractionTarget>();
                if (t && (target == null || t.kind == TargetKind.Board || t.kind == TargetKind.Frame)) target = t;
            }
            if (target) {
                if (tool == Tool.Charcoal && (target.kind == TargetKind.Board || target.kind == TargetKind.Frame))
                    GalleryGame.Instance.Draw(target, target.GetComponent<Collider>().ClosestPoint(Tip));
                else if (target != previousContact) GalleryGame.Instance.Use(target, this);
            }
            previousContact = target;
        }
    }
}
