using UnityEditor;
using UnityEditor.XR.OpenXR.Features;
using UnityEngine;
using UnityEngine.XR.Hands.OpenXR;
using UnityEngine.XR.OpenXR;

[InitializeOnLoad]
public static class HandTrackingSetup
{
    static HandTrackingSetup() => EditorApplication.delayCall += Configure;

    [MenuItem("XR/Configure hand tracking")]
    public static void Configure()
    {
        if (EditorApplication.isPlayingOrWillChangePlaymode) return;
        FeatureHelpers.RefreshFeatures(BuildTargetGroup.Standalone);
        var settings = OpenXRSettings.GetSettingsForBuildTargetGroup(BuildTargetGroup.Standalone);
        if (!settings) return;
        var feature = settings.GetFeature<HandTracking>();
        if (!feature || feature.enabled) return;
        feature.enabled = true;
        EditorUtility.SetDirty(feature);
        EditorUtility.SetDirty(settings);
        AssetDatabase.SaveAssets();
        Debug.Log("OpenXR optical hand tracking enabled for PCVR.");
    }
}
