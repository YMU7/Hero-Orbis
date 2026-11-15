using UnityEditor;
using UnityEngine;
using UnityEngine.XR.Interaction.Toolkit.Interactables;

public static class EaselSetup
{
    public static void Build(Transform room)
    {
        var wood = Mat("Easel Walnut", new Color(0.24f, 0.105f, 0.04f));
        var canvas = Mat("Easel Canvas", new Color(0.97f, 0.93f, 0.81f));
        var gold = Mat("Royal Sword Gold", new Color(0.95f, 0.62f, 0.12f), 0.8f);
        var steel = Mat("Royal Sword Silver", new Color(0.72f, 0.87f, 1f), 0.85f);
        var blue = Mat("Royal Sword Azure", new Color(0.025f, 0.45f, 0.95f), 0.4f);
        blue.EnableKeyword("_EMISSION");
        blue.SetColor("_EmissionColor", new Color(0.02f, 0.55f, 1.4f));
        EditorUtility.SetDirty(blue);
        var ink = Mat("Canvas Ink", new Color(0.025f, 0.045f, 0.085f));
        var root = new GameObject("Drawing Easel").transform;
        root.SetParent(room, false);
        root.localPosition = new Vector3(-2.1f, 0, 8.8f);
        for (int side = -1; side <= 1; side += 2)
        {
            var leg = Part(root, "Front Leg", new Vector3(side * 0.43f, 0.91f, 0.10f), new Vector3(0.075f, 1.84f, 0.09f), wood);
            leg.localRotation = Quaternion.Euler(0, 0, side * 8);
        }
        var rear = Part(root, "Rear Leg", new Vector3(0, 0.85f, 0.4f), new Vector3(0.09f, 1.76f, 0.09f), wood);
        rear.localRotation = Quaternion.Euler(22, 0, 0);
        Part(root, "Canvas Ledge", new Vector3(0, 0.94f, -0.045f), new Vector3(1.22f, 0.09f, 0.24f), wood);
        Part(root, "Canvas Frame", new Vector3(0, 1.57f, 0.015f), new Vector3(1.12f, 1.32f, 0.08f), wood);
        var surface = new GameObject("Drawing Canvas").transform;
        surface.SetParent(root, false);
        surface.localPosition = new Vector3(0, 1.57f, -0.055f);
        Part(surface, "Canvas", Vector3.zero, new Vector3(1, 1.2f, 0.04f), canvas);

        var sword = new GameObject("Royal Drawn Sword");
        sword.transform.SetParent(room, false);
        // Clear of the ledge and legs so the reward falls into the room.
        sword.transform.position = root.TransformPoint(new Vector3(0, 1.4f, -0.6f));
        sword.transform.rotation = Quaternion.Euler(0, 0, 72);
        Part(sword.transform, "Royal Grip", Vector3.zero, new Vector3(0.07f, 0.27f, 0.07f), blue);
        Part(sword.transform, "Gold Pommel", new Vector3(0, -0.18f, 0), Vector3.one * 0.12f, gold, PrimitiveType.Sphere);
        Part(sword.transform, "Swept Gold Guard", new Vector3(0, 0.17f, 0), new Vector3(0.46f, 0.065f, 0.09f), gold);
        Part(sword.transform, "Long Silver Blade", new Vector3(0, 0.74f, 0), new Vector3(0.13f, 1.06f, 0.035f), steel);
        var tip = Part(sword.transform, "Diamond Blade Point", new Vector3(0, 1.27f, 0), new Vector3(0.092f, 0.092f, 0.035f), steel);
        tip.localRotation = Quaternion.Euler(0, 0, 45);
        for (int side = -1; side <= 1; side += 2)
        {
            Part(sword.transform, "Glowing Blade Inlay", new Vector3(0, 0.74f, side * 0.021f), new Vector3(0.025f, 0.96f, 0.009f), blue);
            Part(sword.transform, "Guard Sapphire", new Vector3(0, 0.17f, side * 0.055f), Vector3.one * 0.09f, blue, PrimitiveType.Sphere);
        }
        var body = sword.AddComponent<Rigidbody>();
        body.mass = 0.85f;
        body.collisionDetectionMode = CollisionDetectionMode.ContinuousDynamic;
        var grab = sword.AddComponent<XRGrabInteractable>();
        grab.movementType = XRBaseInteractable.MovementType.Kinematic;
        var attach = new GameObject("Grip Attach").transform;
        attach.SetParent(sword.transform, false);
        grab.attachTransform = attach;
        sword.SetActive(false);
        var drawing = surface.gameObject.AddComponent<DrawingEasel>();
        drawing.penTip = room.Find("Wall Tool Rack/Pen/Nib");
        drawing.rewardSword = sword;
        drawing.inkMaterial = ink;
    }

    static Transform Part(Transform parent, string name, Vector3 position, Vector3 scale, Material material, PrimitiveType type = PrimitiveType.Cube)
    {
        var part = GameObject.CreatePrimitive(type);
        part.name = name;
        part.transform.SetParent(parent, false);
        part.transform.localPosition = position;
        part.transform.localScale = scale;
        part.GetComponent<Renderer>().sharedMaterial = material;
        return part.transform;
    }

    static Material Mat(string name, Color color, float metal = 0)
    {
        string path = "Assets/Materials/" + name + ".mat";
        var mat = AssetDatabase.LoadAssetAtPath<Material>(path);
        if (!mat)
        {
            mat = new Material(Shader.Find("Universal Render Pipeline/Lit"));
            AssetDatabase.CreateAsset(mat, path);
        }
        mat.SetColor("_BaseColor", color);
        mat.SetFloat("_Metallic", metal);
        mat.SetFloat("_Smoothness", metal > 0 ? 0.8f : 0.2f);
        EditorUtility.SetDirty(mat);
        return mat;
    }
}
