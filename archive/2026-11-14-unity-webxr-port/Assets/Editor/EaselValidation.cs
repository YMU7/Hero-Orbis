using System;
using UnityEditor;
using UnityEngine;
using UnityEngine.XR.Interaction.Toolkit.Interactables;

public static class EaselValidation
{
    [MenuItem("XR/Validate drawing easel")]
    public static void Run()
    {
        var original = UnityEngine.Object.FindAnyObjectByType<DrawingEasel>();
        Require(original && original.penTip && original.rewardSword, "Scene easel and pen references");
        Require(original.transform.position.x < GameObject.Find("Framed Princess Portrait").transform.position.x, "Easel is left of princess");
        var clone = UnityEngine.Object.Instantiate(original.gameObject);
        var sword = UnityEngine.Object.Instantiate(original.rewardSword);
        try
        {
            var easel = clone.GetComponent<DrawingEasel>();
            easel.rewardSword = sword;
            Vector3 At(float x, float y, float z) => easel.transform.TransformPoint(new Vector3(x, y, z));
            easel.SampleTip(At(0, 0, -0.03f));
            easel.SampleTip(At(0, 0, -0.03f));
            Require(!easel.HasRewarded && !sword.activeSelf, "Stationary contact does not reward");
            easel.SampleTip(At(0.8f, 0, -0.03f));
            easel.SampleTip(At(0.9f, 0, -0.03f));
            Require(!easel.HasRewarded, "Motion outside canvas does not reward");
            easel.SampleTip(At(0, 0, -0.03f));
            Require(!easel.HasRewarded, "Re-entering canvas starts a fresh contact");
            easel.SampleTip(At(0.001f, 0, -0.03f));
            Require(easel.HasRewarded && sword.activeSelf, "One millimeter stroke releases reward");
            Require(sword.GetComponent<Rigidbody>().useGravity && !sword.GetComponent<Rigidbody>().isKinematic, "Sword falls with gravity");
            Require(sword.GetComponent<XRGrabInteractable>() && !sword.GetComponent<FixedJoint>(), "Reward is grabbable and unmounted");
            easel.SampleTip(At(0.02f, 0, -0.03f));
            Require(clone.GetComponentsInChildren<LineRenderer>().Length == 1, "Reward occurs only once");
            Debug.Log("EASEL VALIDATION PASSED: placement, references, stationary contact, outside motion, re-entry, tiny stroke, gravity, grab, single reward.");
        }
        finally
        {
            UnityEngine.Object.DestroyImmediate(clone);
            UnityEngine.Object.DestroyImmediate(sword);
        }
    }

    static void Require(bool valid, string message)
    {
        if (!valid) throw new InvalidOperationException(message);
    }
}
