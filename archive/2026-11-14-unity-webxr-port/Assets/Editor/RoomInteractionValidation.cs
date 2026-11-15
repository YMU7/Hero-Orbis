using System;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.XR.Interaction.Toolkit;
using UnityEngine.XR.Interaction.Toolkit.Interactables;
using UnityEngine.XR.Interaction.Toolkit.Interactors;

// Runs a physics/interaction smoke check in Play mode without changing scene assets.
[InitializeOnLoad]
public static class RoomInteractionValidation
{
    const string Key = "RoomInteractionValidation.Phase";
    static double next;
    static RoomInteractionValidation() => EditorApplication.update += Update;

    public static void Run()
    {
        EditorSceneManager.OpenScene("Assets/Scenes/XRStart.unity");
        SessionState.SetInt(Key, 1);
        EditorApplication.EnterPlaymode();
    }

    static void Update()
    {
        int phase = SessionState.GetInt(Key, 0);
        if (phase == 0 || !EditorApplication.isPlaying || EditorApplication.isCompiling) return;
        if (EditorApplication.timeSinceStartup < next) return;
        try
        {
            var logo = UnityEngine.Object.FindFirstObjectByType<MuteLogo>();
            Require(logo, "Mute logo exists");
            if (phase == 1)
            {
                Require(!logo.IsActivated && logo.mutedRed.activeSelf && !logo.activeMicrophone.activeSelf, "Room begins muted");
                MoveToLogo(GameObject.Find("Sword").GetComponent<Rigidbody>(), logo, new Vector3(0, 0.54f, 0));
                SessionState.SetInt(Key, 2);
            }
            else if (phase == 2)
            {
                Require(!logo.IsActivated, "Sword must not activate microphone");
                var sword = GameObject.Find("Sword");
                sword.transform.position = Vector3.zero;
                var hammer = GameObject.Find("Hammer").GetComponent<XRGrabInteractable>();
                var ray = GameObject.Find("RightHand Controller").GetComponent<XRRayInteractor>();
                var manager = UnityEngine.Object.FindFirstObjectByType<XRInteractionManager>();
                manager.SelectEnter((IXRSelectInteractor)ray, (IXRSelectInteractable)hammer);
                Require(hammer.isSelected, "Hammer can be held by controller");
                manager.SelectExit((IXRSelectInteractor)ray, (IXRSelectInteractable)hammer);
                Require(!hammer.isSelected && hammer.GetComponent<Rigidbody>().useGravity, "Released hammer uses physics");
                SessionState.SetInt(Key, 3);
            }
            else if (phase == 3)
            {
                var hammer = GameObject.Find("Hammer");
                Require(!hammer.GetComponent<Rigidbody>().isKinematic, "Released hammer becomes dynamic");
                MoveToLogo(hammer.GetComponent<Rigidbody>(), logo, new Vector3(0, 0.40f, 0));
                SessionState.SetInt(Key, 4);
            }
            else
            {
                Require(logo.IsActivated && !logo.mutedRed.activeSelf && logo.activeMicrophone.activeSelf, "Hammer contact activates microphone");
                bool ambiencePlaying = false;
                foreach (var source in logo.GetComponents<AudioSource>())
                    if (source.loop && source.isPlaying) ambiencePlaying = true;
                Require(ambiencePlaying, "Background ambience starts");
                Require(GameObject.Find("Red Logo Shard"), "Red shatter fragments spawn");
                Debug.Log("ROOM INTERACTION VALIDATION PASSED: initial mute, sword rejection, hammer grab/release, hammer collision, active icon, ambience, shards.");
                SessionState.SetInt(Key, 0);
                EditorApplication.Exit(0);
            }
            next = EditorApplication.timeSinceStartup + 0.7;
        }
        catch (Exception error)
        {
            Debug.LogException(error);
            SessionState.SetInt(Key, 0);
            EditorApplication.Exit(1);
        }
    }

    static void MoveToLogo(Rigidbody body, MuteLogo logo, Vector3 contactOffset)
    {
        var joint = body.GetComponent<FixedJoint>();
        if (joint) UnityEngine.Object.DestroyImmediate(joint);
        body.isKinematic = true;
        body.transform.rotation = Quaternion.identity;
        body.transform.position = logo.transform.position + Vector3.back * 0.07f - contactOffset;
        Physics.SyncTransforms();
    }
    static void Require(bool valid, string description)
    {
        if (!valid) throw new InvalidOperationException(description);
    }
}
