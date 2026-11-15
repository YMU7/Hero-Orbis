using UnityEngine;

// Coordinates are in the canvas's unscaled local space; its front faces -Z.
public class DrawingEasel : MonoBehaviour
{
    public Transform penTip;
    public GameObject rewardSword;
    public Material inkMaterial;
    public bool HasRewarded { get; private set; }
    Vector3 previous;
    bool touching;

    void Update()
    {
        if (!penTip || HasRewarded) return;
        SampleTip(penTip.position);
    }

    public void SampleTip(Vector3 worldPosition)
    {
        if (HasRewarded) return;
        var point = transform.InverseTransformPoint(worldPosition);
        bool onCanvas = Mathf.Abs(point.x) <= 0.49f && Mathf.Abs(point.y) <= 0.59f
            && point.z >= -0.055f && point.z <= 0.015f;
        var delta = new Vector2(point.x - previous.x, point.y - previous.y);
        if (onCanvas && touching && delta.sqrMagnitude > 0.00000001f)
        {
            var stroke = new GameObject("First Pen Stroke", typeof(LineRenderer));
            stroke.transform.SetParent(transform, false);
            var line = stroke.GetComponent<LineRenderer>();
            line.useWorldSpace = false;
            line.sharedMaterial = inkMaterial;
            line.startWidth = line.endWidth = 0.008f;
            line.positionCount = 2;
            line.SetPosition(0, new Vector3(previous.x, previous.y, -0.023f));
            line.SetPosition(1, new Vector3(point.x, point.y, -0.023f));
            HasRewarded = true;
            rewardSword.SetActive(true);
            var body = rewardSword.GetComponent<Rigidbody>();
            body.WakeUp();
            body.AddForce(new Vector3(0, 0, -0.4f), ForceMode.VelocityChange);
            body.AddTorque(new Vector3(0, 0, 0.5f), ForceMode.VelocityChange);
        }
        touching = onCanvas;
        previous = point;
    }
}
