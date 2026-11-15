using System.Collections.Generic;
using UnityEngine;
using UnityEngine.InputSystem;
using UnityEngine.XR.Hands;
using UnityEngine.XR.Interaction.Toolkit.Interactors;
using UnityEngine.XR.Interaction.Toolkit.Inputs.Readers;

// Joint poses stay in the camera-offset space, including after locomotion.
[DefaultExecutionOrder(-100)]
public class TrackedHands : MonoBehaviour
{
    public bool left;
    XRHandSubsystem subsystem;
    readonly List<XRHandSubsystem> subsystems = new();
    readonly Transform[] joints = new Transform[27];
    readonly Transform[] bones = new Transform[27];
    readonly bool[] valid = new bool[27];
    GameObject visuals;
    XRDirectInteractor direct;
    XRRayInteractor controllerRay;
    Material material;
    bool pinching;
    bool mustOpen = true;

    [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.AfterSceneLoad)]
    static void Install()
    {
        foreach (bool isLeft in new[] { true, false })
        {
            var controller = GameObject.Find((isLeft ? "LeftHand" : "RightHand") + " Controller");
            if (!controller || !controller.transform.parent) continue;
            var ray = controller.GetComponent<XRRayInteractor>();
            // Also upgrade already-saved scenes without rebuilding the room.
            if (ray != null && ray.selectInput.inputActionPerformed != null)
            {
                var side = isLeft ? "LeftHand" : "RightHand";
                ray.selectInput.inputActionPerformed.Disable();
                ray.selectInput.inputActionPerformed.AddBinding("<XRController>{" + side + "}/triggerPressed");
                ray.selectInput.inputActionPerformed.Enable();
            }
            var hand = new GameObject(isLeft ? "Tracked Left Hand" : "Tracked Right Hand");
            hand.transform.SetParent(controller.transform.parent, false);
            var tracking = hand.AddComponent<TrackedHands>();
            tracking.left = isLeft;
            tracking.controllerRay = ray;
        }
    }

    void Start()
    {
        visuals = new GameObject("Articulated Hand");
        visuals.transform.SetParent(transform.parent, false);
        material = new Material(Shader.Find("Universal Render Pipeline/Lit"));
        material.color = left ? new Color(0.25f, 0.65f, 0.85f) : new Color(0.85f, 0.55f, 0.28f);
        for (int i = 1; i <= 26; i++)
        {
            joints[i] = Part("Joint " + i, PrimitiveType.Sphere);
            bones[i] = Part("Bone " + i, PrimitiveType.Capsule);
        }
        var body = gameObject.AddComponent<Rigidbody>();
        body.isKinematic = true;
        body.useGravity = false;
        var proximity = gameObject.AddComponent<SphereCollider>();
        proximity.isTrigger = true;
        proximity.radius = 0.045f;
        direct = gameObject.AddComponent<XRDirectInteractor>();
        direct.selectActionTrigger = XRBaseInputInteractor.InputTriggerType.State;
        direct.selectInput = new XRInputButtonReader("Pinch", "Pinch", inputSourceMode: XRInputButtonReader.InputSourceMode.ManualValue);
        direct.enabled = false;
        visuals.SetActive(false);
    }

    Transform Part(string label, PrimitiveType type)
    {
        var part = GameObject.CreatePrimitive(type);
        part.name = label;
        part.transform.SetParent(visuals.transform, false);
        Destroy(part.GetComponent<Collider>());
        part.GetComponent<Renderer>().sharedMaterial = material;
        return part.transform;
    }

    void Update()
    {
        if (subsystem == null || !subsystem.running)
        {
            SubsystemManager.GetSubsystems(subsystems);
            subsystem = subsystems.Find(s => s.running);
        }
        if (subsystem == null) { LoseTracking(); return; }
        var hand = left ? subsystem.leftHand : subsystem.rightHand;
        if (!hand.isTracked) { LoseTracking(); return; }
        for (int i = 1; i <= 26; i++)
        {
            valid[i] = hand.GetJoint((XRHandJointID)i).TryGetPose(out var pose);
            joints[i].gameObject.SetActive(valid[i]);
            if (!valid[i]) continue;
            joints[i].localPosition = pose.position;
            joints[i].localRotation = pose.rotation;
            float radius = hand.GetJoint((XRHandJointID)i).TryGetRadius(out var r) ? Mathf.Clamp(r, 0.005f, 0.018f) : 0.009f;
            joints[i].localScale = Vector3.one * radius * 2;
        }
        int thumb = (int)XRHandJointID.ThumbTip, index = (int)XRHandJointID.IndexTip;
        int palm = (int)XRHandJointID.Palm;
        if (!valid[thumb] || !valid[index] || !valid[palm]) { LoseTracking(); return; }
        visuals.SetActive(true);
        for (int i = 1; i <= 26; i++)
        {
            int parent = i <= 2 ? 0 : (i == 3 || i == 7 || i == 12 || i == 17 || i == 22) ? 2 : i - 1;
            bool show = parent > 0 && valid[i] && valid[parent];
            bones[i].gameObject.SetActive(show);
            if (!show) continue;
            var a = joints[parent].localPosition;
            var b = joints[i].localPosition;
            bones[i].localPosition = (a + b) * 0.5f;
            bones[i].localRotation = Quaternion.FromToRotation(Vector3.up, b - a);
            bones[i].localScale = new Vector3(0.014f, Vector3.Distance(a, b) * 0.5f, 0.014f);
        }
        float distance = Vector3.Distance(joints[thumb].localPosition, joints[index].localPosition);
        if (distance > 0.045f) mustOpen = false;
        pinching = !mustOpen && distance < (pinching ? 0.045f : 0.025f);
        transform.localPosition = (joints[thumb].localPosition + joints[index].localPosition) * 0.5f;
        transform.localRotation = joints[palm].localRotation;
        // Do not steal a tool already held by a controller.
        bool controllerHolding = controllerRay && controllerRay.hasSelection;
        direct.enabled = !controllerHolding;
        direct.selectInput.QueueManualState(pinching && !controllerHolding, pinching ? 1 : 0);
        if (controllerRay && !controllerHolding) controllerRay.enabled = false;
    }

    void LoseTracking()
    {
        pinching = false;
        mustOpen = true;
        if (visuals) visuals.SetActive(false);
        if (direct) { direct.selectInput.QueueManualState(false, 0); direct.enabled = false; }
        if (controllerRay) controllerRay.enabled = true;
    }

    void OnDisable() => LoseTracking();
    void OnDestroy()
    {
        if (visuals) Destroy(visuals);
        if (material) Destroy(material);
    }
}
