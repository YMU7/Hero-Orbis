using System;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEditor.XR.Management;
using UnityEditor.XR.Management.Metadata;
using UnityEditor.XR.OpenXR.Features;
using UnityEngine;
using UnityEngine.InputSystem;
using UnityEngine.InputSystem.XR;
using UnityEngine.XR;
using UnityEngine.XR.Management;
using UnityEngine.XR.OpenXR;
using UnityEngine.XR.OpenXR.Features;
using UnityEngine.XR.OpenXR.Features.Interactions;
using Unity.XR.CoreUtils;
using UnityEngine.XR.Interaction.Toolkit;

[InitializeOnLoad]
public static class XRProjectSetup
{
    const string ScenePath = "Assets/Scenes/XRStart.unity";

    static XRProjectSetup()
    {
        EditorApplication.delayCall += () =>
        {
            if (!Application.isBatchMode && !System.IO.File.Exists(ScenePath))
                Create();
        };
    }

    [MenuItem("XR/Create fresh starter scene")]
    public static void Create()
    {
        PlayerSettings.companyName = "Immerse the Bay";
        PlayerSettings.productName = "Immerse the Bay 2026";
        PlayerSettings.runInBackground = true;

        if (!AssetDatabase.IsValidFolder("Assets/XR"))
            AssetDatabase.CreateFolder("Assets", "XR");
        if (!EditorBuildSettings.TryGetConfigObject<XRGeneralSettingsPerBuildTarget>(XRGeneralSettings.k_SettingsKey, out var targets) || !targets)
        {
            targets = ScriptableObject.CreateInstance<XRGeneralSettingsPerBuildTarget>();
            AssetDatabase.CreateAsset(targets, "Assets/XR/GeneralSettings.asset");
            EditorBuildSettings.AddConfigObject(XRGeneralSettings.k_SettingsKey, targets, true);
        }
        if (!targets.HasSettingsForBuildTarget(BuildTargetGroup.Standalone))
            targets.CreateDefaultSettingsForBuildTarget(BuildTargetGroup.Standalone);
        if (!targets.HasManagerSettingsForBuildTarget(BuildTargetGroup.Standalone))
            targets.CreateDefaultManagerSettingsForBuildTarget(BuildTargetGroup.Standalone);
        var settings = targets.SettingsForBuildTarget(BuildTargetGroup.Standalone);
        settings.InitManagerOnStart = true;
        if (!XRPackageMetadataStore.AssignLoader(settings.Manager, "UnityEngine.XR.OpenXR.OpenXRLoader", BuildTargetGroup.Standalone))
            throw new InvalidOperationException("Unable to assign OpenXR loader.");
        FeatureHelpers.RefreshFeatures(BuildTargetGroup.Standalone);
        var openXR = OpenXRSettings.GetSettingsForBuildTargetGroup(BuildTargetGroup.Standalone);
        foreach (var feature in openXR.GetFeatures<OpenXRInteractionFeature>())
            if (feature is OculusTouchControllerProfile || feature is ValveIndexControllerProfile || feature is HTCViveControllerProfile)
                feature.enabled = true;
        EditorUtility.SetDirty(targets);
        EditorUtility.SetDirty(settings);
        EditorUtility.SetDirty(settings.Manager);
        EditorUtility.SetDirty(openXR);

        EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
        var originObject = new GameObject("XR Origin");
        var origin = originObject.AddComponent<XROrigin>();
        var offset = new GameObject("Camera Offset");
        offset.transform.SetParent(originObject.transform, false);
        origin.CameraFloorOffsetObject = offset;
        origin.RequestedTrackingOriginMode = XROrigin.TrackingOriginMode.Floor;
        origin.CameraYOffset = 1.6f;

        var head = new GameObject("Main Camera", typeof(Camera), typeof(AudioListener));
        head.tag = "MainCamera";
        head.transform.SetParent(offset.transform, false);
        var camera = head.GetComponent<Camera>();
        camera.nearClipPlane = 0.05f;
        camera.farClipPlane = 100f;
        origin.Camera = camera;
        AddTracking(head, "<XRHMD>/centerEyePosition", "<XRHMD>/centerEyeRotation");
        foreach (var hand in new[] { "LeftHand", "RightHand" })
        {
            var controller = new GameObject(hand + " Controller");
            controller.transform.SetParent(offset.transform, false);
            AddTracking(controller, "<XRController>{" + hand + "}/devicePosition", "<XRController>{" + hand + "}/deviceRotation");
        }
        new GameObject("XR Interaction Manager").AddComponent<XRInteractionManager>();
        RoomSetup.BuildRoom();
        EditorSceneManager.SaveScene(EditorSceneManager.GetActiveScene(), ScenePath);
        EditorBuildSettings.scenes = new[] { new EditorBuildSettingsScene(ScenePath, true) };
        AssetDatabase.SaveAssets();
        Debug.Log("Fresh XR starter configured successfully: " + ScenePath);
    }

    static void AddTracking(GameObject target, string position, string rotation)
    {
        var tracking = target.AddComponent<TrackedPoseDriver>();
        tracking.positionInput = new InputActionProperty(new InputAction("Position", InputActionType.Value, position, expectedControlType: "Vector3"));
        tracking.rotationInput = new InputActionProperty(new InputAction("Rotation", InputActionType.Value, rotation, expectedControlType: "Quaternion"));
    }
}
