using UnityEditor;
using UnityEngine;

public static class MuteLogoSetup
{
    public static void Build(Transform room)
    {
        var red = Mat("Mute Red", new Color(0.85f, 0.025f, 0.035f));
        var black = Mat("Microphone Black", new Color(0.025f, 0.035f, 0.045f));
        var white = Mat("Microphone Backplate", new Color(0.92f, 0.90f, 0.84f));
        var green = Mat("Active Microphone", new Color(0.06f, 0.6f, 0.28f));
        var root = new GameObject("Hammer Mute Toggle");
        root.transform.SetParent(room, false);
        root.transform.localPosition = new Vector3(0, 0.55f, 9.87f);
        var plate = GameObject.CreatePrimitive(PrimitiveType.Cylinder);
        plate.name = "Microphone Backplate";
        plate.transform.SetParent(root.transform, false);
        plate.transform.localRotation = Quaternion.Euler(90, 0, 0);
        plate.transform.localScale = new Vector3(0.64f, 0.016f, 0.64f);
        plate.GetComponent<Renderer>().sharedMaterial = white;
        Object.DestroyImmediate(plate.GetComponent<Collider>());

        var capsule = GameObject.CreatePrimitive(PrimitiveType.Capsule);
        capsule.name = "Microphone";
        capsule.transform.SetParent(root.transform, false);
        capsule.transform.localPosition = new Vector3(0, 0.065f, -0.025f);
        capsule.transform.localScale = new Vector3(0.10f, 0.095f, 0.025f);
        capsule.GetComponent<Renderer>().sharedMaterial = black;
        Object.DestroyImmediate(capsule.GetComponent<Collider>());
        var cradle = new Vector3[19];
        cradle[0] = new Vector3(-0.11f, 0.11f, -0.04f);
        for (int i = 0; i <= 16; i++)
        {
            float theta = Mathf.PI + i * Mathf.PI / 16;
            cradle[i + 1] = new Vector3(Mathf.Cos(theta) * 0.11f, 0.015f + Mathf.Sin(theta) * 0.11f, -0.04f);
        }
        cradle[18] = new Vector3(0.11f, 0.11f, -0.04f);
        Line(root.transform, "Microphone Cradle", cradle, black, 0.022f);
        Line(root.transform, "Microphone Stand", new[] { new Vector3(0, -0.09f, -0.04f), new Vector3(0, -0.18f, -0.04f) }, black, 0.022f);
        Line(root.transform, "Microphone Base", new[] { new Vector3(-0.08f, -0.18f, -0.04f), new Vector3(0.08f, -0.18f, -0.04f) }, black, 0.022f);

        var muted = new GameObject("Red Mute Circle And Slash").transform;
        muted.SetParent(root.transform, false);
        Circle(muted, red);
        Line(muted, "Mute Slash", new[] { new Vector3(-0.20f, 0.20f, -0.065f), new Vector3(0.20f, -0.20f, -0.065f) }, red, 0.04f);
        var active = new GameObject("Active Microphone Indicator").transform;
        active.SetParent(root.transform, false);
        Circle(active, green);
        for (int side = -1; side <= 1; side += 2)
            Line(active, "Sound Wave", new[] { new Vector3(side * 0.16f, 0.13f, -0.05f), new Vector3(side * 0.20f, 0.07f, -0.05f), new Vector3(side * 0.21f, 0.015f, -0.05f), new Vector3(side * 0.19f, -0.05f, -0.05f) }, green, 0.018f);
        active.gameObject.SetActive(false);
        var trigger = root.AddComponent<BoxCollider>();
        trigger.isTrigger = true;
        trigger.center = new Vector3(0, 0, -0.05f);
        trigger.size = new Vector3(0.64f, 0.64f, 0.13f);
        var toggle = root.AddComponent<MuteLogo>();
        toggle.mutedRed = muted.gameObject;
        toggle.activeMicrophone = active.gameObject;
        toggle.shardMaterial = red;
    }

    static void Circle(Transform parent, Material material)
    {
        var points = new Vector3[65];
        for (int i = 0; i < points.Length; i++)
        {
            float angle = i * Mathf.PI * 2 / 64;
            points[i] = new Vector3(Mathf.Cos(angle) * 0.275f, Mathf.Sin(angle) * 0.275f, -0.055f);
        }
        Line(parent, "Circle", points, material, 0.035f);
    }
    static void Line(Transform parent, string name, Vector3[] points, Material material, float width)
    {
        var line = new GameObject(name).AddComponent<LineRenderer>();
        line.transform.SetParent(parent, false);
        line.useWorldSpace = false;
        line.positionCount = points.Length;
        line.SetPositions(points);
        line.widthMultiplier = width;
        line.numCapVertices = 4;
        line.numCornerVertices = 4;
        line.sharedMaterial = material;
    }
    static Material Mat(string name, Color color)
    {
        string path = "Assets/Materials/" + name + ".mat";
        var material = AssetDatabase.LoadAssetAtPath<Material>(path);
        if (!material)
        {
            material = new Material(Shader.Find("Universal Render Pipeline/Unlit"));
            AssetDatabase.CreateAsset(material, path);
        }
        material.SetColor("_BaseColor", color);
        EditorUtility.SetDirty(material);
        return material;
    }
}
