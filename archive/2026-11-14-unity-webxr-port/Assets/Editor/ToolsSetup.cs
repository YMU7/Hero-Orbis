using System;
using UnityEditor;
using UnityEngine;
using UnityEngine.InputSystem;
using UnityEngine.XR.Interaction.Toolkit.Interactables;
using UnityEngine.XR.Interaction.Toolkit.Interactors;
using UnityEngine.XR.Interaction.Toolkit.Interactors.Visuals;
using UnityEngine.XR.Interaction.Toolkit.Inputs.Readers;

public static class ToolsSetup
{
    public static void Build(Transform room)
    {
        if (!AssetDatabase.IsValidFolder("Assets/Prefabs")) AssetDatabase.CreateFolder("Assets", "Prefabs");
        var wood = Mat("Tool Wood", new Color(0.25f, 0.10f, 0.035f), 0, 0.3f);
        var steel = Mat("Tool Steel", new Color(0.58f, 0.65f, 0.72f), 0.7f, 0.65f);
        var gold = Mat("Tool Brass", new Color(0.65f, 0.39f, 0.10f), 0.6f, 0.55f);
        var ink = Mat("Pen Enamel", new Color(0.025f, 0.045f, 0.085f), 0.3f, 0.6f);
        var rack = new GameObject("Wall Tool Rack").transform;
        rack.SetParent(room, false);
        Part(rack, "Mounting Board", PrimitiveType.Cube, new Vector3(2.45f, 1.65f, 9.91f), new Vector3(2.3f, 0.22f, 0.1f), wood);
        for (int i = 0; i < 3; i++)
        {
            string name = new[] { "Hammer", "Sword", "Pen" }[i];
            var tool = new GameObject(name);
            if (i == 0)
            {
                Part(tool.transform, "Handle", PrimitiveType.Cylinder, new Vector3(0, 0.12f, 0), new Vector3(0.055f, 0.23f, 0.055f), wood);
                Part(tool.transform, "Steel Head", PrimitiveType.Cube, new Vector3(0, 0.40f, 0), new Vector3(0.32f, 0.13f, 0.13f), steel);
                tool.transform.Find("Steel Head").gameObject.AddComponent<HammerHead>();
            }
            else if (i == 1)
            {
                Part(tool.transform, "Grip", PrimitiveType.Cylinder, Vector3.zero, new Vector3(0.055f, 0.12f, 0.055f), wood);
                Part(tool.transform, "Pommel", PrimitiveType.Sphere, new Vector3(0, -0.14f, 0), Vector3.one * 0.08f, gold);
                Part(tool.transform, "Crossguard", PrimitiveType.Cube, new Vector3(0, 0.15f, 0), new Vector3(0.34f, 0.05f, 0.065f), gold);
                Part(tool.transform, "Blade", PrimitiveType.Cube, new Vector3(0, 0.54f, 0), new Vector3(0.085f, 0.73f, 0.025f), steel);
                var tip = Part(tool.transform, "Blade Point", PrimitiveType.Cube, new Vector3(0, 0.92f, 0), new Vector3(0.06f, 0.06f, 0.025f), steel);
                tip.localRotation = Quaternion.Euler(0, 0, 45);
            }
            else
            {
                Part(tool.transform, "Barrel", PrimitiveType.Cylinder, new Vector3(0, 0.035f, 0), new Vector3(0.025f, 0.12f, 0.025f), ink);
                Part(tool.transform, "Gold Band", PrimitiveType.Cylinder, new Vector3(0, 0.10f, 0), new Vector3(0.029f, 0.012f, 0.029f), gold);
                Part(tool.transform, "Nib", PrimitiveType.Cylinder, new Vector3(0, -0.105f, 0), new Vector3(0.009f, 0.025f, 0.009f), gold);
                Part(tool.transform, "Clip", PrimitiveType.Cube, new Vector3(0, 0.105f, -0.017f), new Vector3(0.008f, 0.07f, 0.009f), gold);
                // A forgiving invisible collider makes the small pen easier to point at.
                var hit = tool.AddComponent<BoxCollider>();
                hit.center = new Vector3(0, 0.02f, 0);
                hit.size = new Vector3(0.075f, 0.31f, 0.075f);
            }
            var body = tool.AddComponent<Rigidbody>();
            body.mass = i == 0 ? 0.8f : i == 1 ? 1.1f : 0.04f;
            body.collisionDetectionMode = CollisionDetectionMode.ContinuousDynamic;
            var grab = tool.AddComponent<XRGrabInteractable>();
            grab.movementType = XRBaseInteractable.MovementType.Kinematic;
            var grip = new GameObject("Grip Attach").transform;
            grip.SetParent(tool.transform, false);
            grab.attachTransform = grip;
            grab.throwOnDetach = true;
            tool.AddComponent<FixedJoint>();
            tool.AddComponent<WallMountedTool>();
            string path = "Assets/Prefabs/" + name + ".prefab";
            PrefabUtility.SaveAsPrefabAsset(tool, path);
            UnityEngine.Object.DestroyImmediate(tool);
            var instance = (GameObject)PrefabUtility.InstantiatePrefab(AssetDatabase.LoadAssetAtPath<GameObject>(path), rack);
            instance.transform.localPosition = new Vector3(1.65f + i * 0.8f, 1.55f, 9.66f);
            if (!instance.GetComponent<XRGrabInteractable>() || !instance.GetComponent<Rigidbody>() || instance.GetComponentsInChildren<Collider>().Length == 0)
                throw new InvalidOperationException(name + " is missing grab/physics components.");
            Part(rack, name + " Wall Peg", PrimitiveType.Cube, new Vector3(1.65f + i * 0.8f, 1.46f, 9.78f), new Vector3(0.10f, 0.05f, 0.22f), gold);
        }
        foreach (var hand in new[] { "LeftHand", "RightHand" })
        {
            var controller = GameObject.Find(hand + " Controller");
            var oldRay = controller.GetComponent<XRRayInteractor>();
            if (oldRay) UnityEngine.Object.DestroyImmediate(oldRay);
            var ray = controller.AddComponent<XRRayInteractor>();
            ray.maxRaycastDistance = 15;
            ray.useForceGrab = true;
            ray.selectActionTrigger = XRBaseInputInteractor.InputTriggerType.State;
            ray.selectInput = new XRInputButtonReader("Grab", "Grip", inputSourceMode: XRInputButtonReader.InputSourceMode.InputAction)
            {
                inputActionPerformed = new InputAction("Grab", InputActionType.Button, "<XRController>{" + hand + "}/gripPressed"),
                inputActionValue = new InputAction("Grip", InputActionType.Value, "<XRController>{" + hand + "}/grip", expectedControlType: "Axis")
            };
            ray.selectInput.inputActionPerformed.AddBinding("<XRController>{" + hand + "}/triggerPressed");
            ray.selectInput.inputActionValue.AddBinding("<XRController>{" + hand + "}/trigger");
            if (!controller.GetComponent<LineRenderer>()) controller.AddComponent<LineRenderer>();
            if (!controller.GetComponent<XRInteractorLineVisual>()) controller.AddComponent<XRInteractorLineVisual>();
        }
        var origin = GameObject.Find("XR Origin");
        var character = origin.GetComponent<CharacterController>();
        if (!character) character = origin.AddComponent<CharacterController>();
        character.radius = 0.2f;
        character.height = 1.7f;
        character.center = new Vector3(0, 0.85f, 0);
        if (!origin.GetComponent<RoomLocomotion>()) origin.AddComponent<RoomLocomotion>();
        Debug.Log("Validated three grabbable tool prefabs and grip-to-hold controller rays.");
    }

    static Transform Part(Transform parent, string name, PrimitiveType type, Vector3 position, Vector3 scale, Material material)
    {
        var part = GameObject.CreatePrimitive(type);
        part.name = name;
        part.transform.SetParent(parent, false);
        part.transform.localPosition = position;
        part.transform.localScale = scale;
        part.GetComponent<Renderer>().sharedMaterial = material;
        return part.transform;
    }

    static Material Mat(string name, Color color, float metallic, float smoothness)
    {
        var path = "Assets/Materials/" + name + ".mat";
        var material = AssetDatabase.LoadAssetAtPath<Material>(path);
        if (!material)
        {
            material = new Material(Shader.Find("Universal Render Pipeline/Lit"));
            AssetDatabase.CreateAsset(material, path);
        }
        material.SetColor("_BaseColor", color);
        material.SetFloat("_Metallic", metallic);
        material.SetFloat("_Smoothness", smoothness);
        EditorUtility.SetDirty(material);
        return material;
    }
}
