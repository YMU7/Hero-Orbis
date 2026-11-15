using System.IO;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.Rendering;

public static class RoomSetup
{
    [MenuItem("XR/Build portrait room")]
    public static void Create()
    {
        var renderer = AssetDatabase.LoadAssetAtPath<UnityEngine.Object>("Assets/Settings/PC_Renderer.asset");
        var rendererSettings = new SerializedObject(renderer);
        rendererSettings.FindProperty("m_RenderingMode").intValue = 0;
        rendererSettings.ApplyModifiedPropertiesWithoutUndo();
        EditorSceneManager.OpenScene("Assets/Scenes/XRStart.unity");
        BuildRoom();
        EditorSceneManager.SaveScene(EditorSceneManager.GetActiveScene());
        AssetDatabase.SaveAssets();
        RenderPreview();
        Debug.Log("Portrait room saved successfully.");
    }

    public static void BuildRoom()
    {
        foreach (var name in new[] { "Room", "Floor", "Directional Light" })
        {
            var existing = GameObject.Find(name);
            if (existing) Object.DestroyImmediate(existing);
        }
        if (!AssetDatabase.IsValidFolder("Assets/Materials"))
            AssetDatabase.CreateFolder("Assets", "Materials");
        var wall = Material("Plaster", new Color(0.72f, 0.69f, 0.62f));
        var floor = Material("Floor", new Color(0.27f, 0.24f, 0.20f));
        var ceiling = Material("Ceiling", new Color(0.82f, 0.80f, 0.74f));
        var frame = Material("Portrait Frame", new Color(0.44f, 0.29f, 0.10f));
        var painting = Material("Princess Portrait", Color.white, true);
        painting.SetTexture("_BaseMap", AssetDatabase.LoadAssetAtPath<Texture2D>("Assets/Art/Princess.jpg"));
        EditorUtility.SetDirty(painting);

        var root = new GameObject("Room").transform;
        // Interior bounds: x [-4,4], y [0,4], z [-2,10], in meters.
        Box(root, "Floor", new Vector3(0, -0.1f, 4), new Vector3(8.4f, 0.2f, 12.4f), floor);
        Box(root, "Ceiling", new Vector3(0, 4.1f, 4), new Vector3(8.4f, 0.2f, 12.4f), ceiling);
        Box(root, "Left Wall", new Vector3(-4.1f, 2, 4), new Vector3(0.2f, 4, 12.4f), wall);
        Box(root, "Right Wall", new Vector3(4.1f, 2, 4), new Vector3(0.2f, 4, 12.4f), wall);
        Box(root, "Near Wall", new Vector3(0, 2, -2.1f), new Vector3(8, 4, 0.2f), wall);
        Box(root, "Far Wall", new Vector3(0, 2, 10.1f), new Vector3(8, 4, 0.2f), wall);

        var portrait = new GameObject("Framed Princess Portrait").transform;
        portrait.SetParent(root, false);
        portrait.localPosition = new Vector3(0, 2, 9.88f);
        const float height = 2f;
        float width = height * 469f / 620f;
        Box(portrait, "Frame Backing", Vector3.zero, new Vector3(width + 0.16f, height + 0.16f, 0.08f), frame);
        var canvas = GameObject.CreatePrimitive(PrimitiveType.Quad);
        canvas.name = "Princess Portrait";
        canvas.transform.SetParent(portrait, false);
        canvas.transform.localPosition = new Vector3(0, 0, -0.045f);
        canvas.transform.localScale = new Vector3(width, height, 1);
        canvas.GetComponent<Renderer>().sharedMaterial = painting;
        Object.DestroyImmediate(canvas.GetComponent<Collider>());

        RenderSettings.ambientMode = AmbientMode.Flat;
        RenderSettings.ambientLight = new Color(0.65f, 0.65f, 0.65f);
        for (int i = 0; i < 3; i++)
        {
            var lightObject = new GameObject("Ceiling Light " + (i + 1), typeof(Light));
            lightObject.transform.SetParent(root, false);
            lightObject.transform.localPosition = new Vector3(0, 3.5f, 1 + i * 3.5f);
            var light = lightObject.GetComponent<Light>();
            light.type = LightType.Point;
            light.range = 9;
            light.intensity = 2;
            light.color = new Color(1, 0.94f, 0.84f);
        }
        ToolsSetup.Build(root);
        MuteLogoSetup.Build(root);
        EaselSetup.Build(root);
    }

    static Material Material(string name, Color color, bool unlit = false)
    {
        string path = "Assets/Materials/" + name + ".mat";
        var material = AssetDatabase.LoadAssetAtPath<Material>(path);
        if (!material)
        {
            material = new Material(Shader.Find(unlit ? "Universal Render Pipeline/Unlit" : "Universal Render Pipeline/Lit"));
            AssetDatabase.CreateAsset(material, path);
        }
        material.SetColor("_BaseColor", color);
        if (material.HasProperty("_Smoothness")) material.SetFloat("_Smoothness", 0.15f);
        EditorUtility.SetDirty(material);
        return material;
    }

    static void Box(Transform parent, string name, Vector3 position, Vector3 scale, Material material)
    {
        var box = GameObject.CreatePrimitive(PrimitiveType.Cube);
        box.name = name;
        box.transform.SetParent(parent, false);
        box.transform.localPosition = position;
        box.transform.localScale = scale;
        box.GetComponent<Renderer>().sharedMaterial = material;
    }

    static void RenderPreview()
    {
        ShaderUtil.allowAsyncCompilation = false;
        var preview = new GameObject("Preview Camera", typeof(Camera));
        var camera = preview.GetComponent<Camera>();
        preview.transform.position = new Vector3(0, 1.65f, -0.5f);
        camera.fieldOfView = 65;
        camera.nearClipPlane = 0.05f;
        var target = new RenderTexture(1280, 800, 24);
        camera.targetTexture = target;
        camera.Render();
        var previous = RenderTexture.active;
        RenderTexture.active = target;
        var image = new Texture2D(1280, 800, TextureFormat.RGB24, false);
        image.ReadPixels(new Rect(0, 0, 1280, 800), 0, 0);
        image.Apply();
        Directory.CreateDirectory("Logs");
        File.WriteAllBytes("Logs/RoomPreview.png", image.EncodeToPNG());
        RenderTexture.active = previous;
        camera.targetTexture = null;
        target.Release();
        Object.DestroyImmediate(image);
        Object.DestroyImmediate(target);
        Object.DestroyImmediate(preview);
    }
}
