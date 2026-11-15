using System;
using System.IO;
using UnityEditor;
using UnityEditor.Build;
using UnityEditor.Build.Reporting;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.XR.Management;
using UnityEditor.XR.Management;
using UnityEditor.XR.Management.Metadata;
using UnityEngine.XR.OpenXR;
using UnityEngine.XR.OpenXR.Features.Interactions;
using UnityEditor.XR.OpenXR.Features;

namespace PoorWords.Editor
{
    [InitializeOnLoad]
    public static class ProjectSetup
    {
        const string SetupKey = "PoorWords.Configured.v1";
        static ProjectSetup() {
            EditorApplication.delayCall += () => {
                if (!Application.isBatchMode && !SessionState.GetBool(SetupKey,false)) {
                    Configure();SessionState.SetBool(SetupKey,true);
                }
            };
        }
        [MenuItem("Poor Words/Configure PCVR project")]
        public static void Configure() {
            PlayerSettings.companyName="Royal Restoration Society";
            PlayerSettings.productName="A Poor Choice of Words";
            PlayerSettings.runInBackground=true;
            PlayerSettings.defaultScreenWidth=1280;PlayerSettings.defaultScreenHeight=800;
            PlayerSettings.fullScreenMode=FullScreenMode.Windowed;
            PlayerSettings.SetScriptingBackend(NamedBuildTarget.Standalone,ScriptingImplementation.Mono2x);
            // Both APIs enabled: desktop uses Input System, XR uses the documented XRInput API.
            var player = new SerializedObject(AssetDatabase.LoadAllAssetsAtPath("ProjectSettings/ProjectSettings.asset")[0]);
            var handler=player.FindProperty("activeInputHandler");if(handler!=null && handler.intValue!=2) {handler.intValue=2;player.ApplyModifiedPropertiesWithoutUndo();}
            EditorBuildSettings.scenes=new[]{new EditorBuildSettingsScene("Assets/Scenes/Gallery.unity",true)};
            if(!AssetDatabase.IsValidFolder("Assets/XR")) AssetDatabase.CreateFolder("Assets","XR");
            if(!EditorBuildSettings.TryGetConfigObject<XRGeneralSettingsPerBuildTarget>(XRGeneralSettings.k_SettingsKey,out var perTarget) || !perTarget) {
                perTarget=ScriptableObject.CreateInstance<XRGeneralSettingsPerBuildTarget>();
                AssetDatabase.CreateAsset(perTarget,"Assets/XR/GeneralSettings.asset");
                EditorBuildSettings.AddConfigObject(XRGeneralSettings.k_SettingsKey,perTarget,true);
            }
            if(!perTarget.HasSettingsForBuildTarget(BuildTargetGroup.Standalone)) perTarget.CreateDefaultSettingsForBuildTarget(BuildTargetGroup.Standalone);
            if(!perTarget.HasManagerSettingsForBuildTarget(BuildTargetGroup.Standalone)) perTarget.CreateDefaultManagerSettingsForBuildTarget(BuildTargetGroup.Standalone);
            var settings=perTarget.SettingsForBuildTarget(BuildTargetGroup.Standalone);settings.InitManagerOnStart=Application.platform==RuntimePlatform.WindowsEditor;
            if(!XRPackageMetadataStore.AssignLoader(settings.Manager,"UnityEngine.XR.OpenXR.OpenXRLoader",BuildTargetGroup.Standalone))
                throw new InvalidOperationException("Could not assign the OpenXR loader. Check Package Manager errors.");
            FeatureHelpers.RefreshFeatures(BuildTargetGroup.Standalone);
            var openXR=OpenXRSettings.GetSettingsForBuildTargetGroup(BuildTargetGroup.Standalone);
            var touch=openXR.GetFeature<OculusTouchControllerProfile>();if(touch) touch.enabled=true;
            var index=openXR.GetFeature<ValveIndexControllerProfile>();if(index) index.enabled=true;
            var vive=openXR.GetFeature<HTCViveControllerProfile>();if(vive) vive.enabled=true;
            EditorUtility.SetDirty(perTarget);EditorUtility.SetDirty(settings);EditorUtility.SetDirty(settings.Manager);EditorUtility.SetDirty(openXR);
            // Shader.Find is used for graybox props. Retain both shaders in standalone builds.
            var graphics=AssetDatabase.LoadAllAssetsAtPath("ProjectSettings/GraphicsSettings.asset");
            if(graphics.Length>0) {
                var obj=new SerializedObject(graphics[0]);var shaders=obj.FindProperty("m_AlwaysIncludedShaders");
                foreach(var name in new[]{"Standard","Sprites/Default"}) {
                    var shader=Shader.Find(name);bool found=false;
                    for(int i=0;i<shaders.arraySize;i++) if(shaders.GetArrayElementAtIndex(i).objectReferenceValue==shader) found=true;
                    if(!found && shader) {int n=shaders.arraySize;shaders.InsertArrayElementAtIndex(n);shaders.GetArrayElementAtIndex(n).objectReferenceValue=shader;}
                }
                obj.ApplyModifiedPropertiesWithoutUndo();
            }
            AssetDatabase.SaveAssets();Debug.Log("Poor Words: PCVR configured. Open Gallery and press Play. Desktop works without a headset.");
        }
        [MenuItem("Poor Words/Open gallery")]
        public static void OpenGallery() => EditorSceneManager.OpenScene("Assets/Scenes/Gallery.unity");
        [MenuItem("Poor Words/Build Windows PCVR player")]
        public static void BuildWindows() {
            Configure();Directory.CreateDirectory("Builds/Windows");
            var settings=XRGeneralSettingsPerBuildTarget.XRGeneralSettingsForBuildTarget(BuildTargetGroup.Standalone);
            bool previous=settings.InitManagerOnStart;
            try {
                settings.InitManagerOnStart=true;EditorUtility.SetDirty(settings);AssetDatabase.SaveAssets();
                var report=BuildPipeline.BuildPlayer(new BuildPlayerOptions {
                    scenes=new[]{"Assets/Scenes/Gallery.unity"},locationPathName="Builds/Windows/PoorWords.exe",
                    target=BuildTarget.StandaloneWindows64,options=BuildOptions.Development
                });
                if(report.summary.result!=BuildResult.Succeeded) throw new Exception("Build failed: "+report.summary.result);
            } finally {settings.InitManagerOnStart=previous;EditorUtility.SetDirty(settings);AssetDatabase.SaveAssets();}
        }
        [MenuItem("Poor Words/Build Linux desktop player")]
        public static void BuildLinux() {
            Configure();Directory.CreateDirectory("Builds/Linux");
            var settings=XRGeneralSettingsPerBuildTarget.XRGeneralSettingsForBuildTarget(BuildTargetGroup.Standalone);
            settings.InitManagerOnStart=false;EditorUtility.SetDirty(settings);AssetDatabase.SaveAssets();
            var report=BuildPipeline.BuildPlayer(new BuildPlayerOptions {
                scenes=new[]{"Assets/Scenes/Gallery.unity"},locationPathName="Builds/Linux/PoorWords.x86_64",
                target=BuildTarget.StandaloneLinux64,options=BuildOptions.Development
            });
            if(report.summary.result!=BuildResult.Succeeded) throw new Exception("Build failed: "+report.summary.result);
        }
    }
}
