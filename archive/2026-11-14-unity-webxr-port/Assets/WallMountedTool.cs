using UnityEngine;
using UnityEngine.XR.Interaction.Toolkit;
using UnityEngine.XR.Interaction.Toolkit.Interactables;

// The wall mount holds the tool until its first grab. Released tools then use physics.
[RequireComponent(typeof(XRGrabInteractable), typeof(Rigidbody))]
public class WallMountedTool : MonoBehaviour
{
    void OnEnable() => GetComponent<XRGrabInteractable>().selectEntered.AddListener(Unhook);
    void OnDisable() => GetComponent<XRGrabInteractable>().selectEntered.RemoveListener(Unhook);
    void Unhook(SelectEnterEventArgs args)
    {
        var mount = GetComponent<FixedJoint>();
        if (mount) Destroy(mount);
    }
}
