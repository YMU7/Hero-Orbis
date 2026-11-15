using UnityEngine;

public class MuteLogo : MonoBehaviour
{
    public GameObject mutedRed;
    public GameObject activeMicrophone;
    public Material shardMaterial;
    public bool IsActivated { get; private set; }
    AudioSource ambience;
    AudioSource impact;
    AudioClip ambienceClip;
    AudioClip impactClip;

    void Awake()
    {
        activeMicrophone.SetActive(false);
        mutedRed.SetActive(true);
        ambience = gameObject.AddComponent<AudioSource>();
        ambience.playOnAwake = false;
        ambience.loop = true;
        ambience.spatialBlend = 0;
        ambience.volume = 0.16f;
        impact = gameObject.AddComponent<AudioSource>();
        impact.playOnAwake = false;
        impact.spatialBlend = 0.6f;
        impact.minDistance = 2;
        impact.maxDistance = 18;
        impact.volume = 1;
        ambienceClip = MakeSound(false);
        impactClip = MakeSound(true);
        ambience.clip = ambienceClip;
    }

    void OnTriggerEnter(Collider other)
    {
        if (!IsActivated && other.GetComponent<HammerHead>()) Activate();
    }

    void Activate()
    {
        IsActivated = true;
        mutedRed.SetActive(false);
        activeMicrophone.SetActive(true);
        impact.PlayOneShot(impactClip);
        ambience.Play();
        for (int i = 0; i < 28; i++)
        {
            float angle = i * Mathf.PI * 2 / 28;
            var shard = GameObject.CreatePrimitive(PrimitiveType.Cube);
            shard.name = "Red Logo Shard";
            shard.transform.position = transform.TransformPoint(new Vector3(Mathf.Cos(angle) * 0.27f, Mathf.Sin(angle) * 0.27f, -0.07f));
            shard.transform.localScale = new Vector3(0.025f, 0.05f, 0.015f);
            shard.transform.rotation = Quaternion.Euler(0, 0, angle * Mathf.Rad2Deg);
            shard.GetComponent<Renderer>().sharedMaterial = shardMaterial;
            var body = shard.AddComponent<Rigidbody>();
            body.mass = 0.01f;
            body.linearVelocity = new Vector3(Mathf.Cos(angle) * 0.8f, 1.0f + Mathf.Sin(angle) * 0.8f, -0.8f);
            body.angularVelocity = new Vector3(i % 3 + 1, i % 5, 3);
            Destroy(shard, 2.5f);
        }
    }

    static AudioClip MakeSound(bool shatter)
    {
        const int rate = 22050;
        int count = rate * (shatter ? 1 : 4);
        var data = new float[count];
        var random = new System.Random(shatter ? 17 : 43);
        float low = 0;
        for (int i = 0; i < count; i++)
        {
            float t = i / (float)rate;
            float noise = (float)random.NextDouble() * 2 - 1;
            low = low * 0.985f + noise * 0.015f;
            if (shatter)
            {
                float crack = noise * Mathf.Exp(-t * 30) * 0.75f;
                float glass = (Mathf.Sin(t * 2 * Mathf.PI * 2341) + Mathf.Sin(t * 2 * Mathf.PI * 3577) * 0.5f) * Mathf.Exp(-t * 7) * 0.22f;
                data[i] = Mathf.Clamp(crack + glass + low * Mathf.Exp(-t * 12), -1, 1);
            }
            else
            {
                float fade = Mathf.Min(1, i / 600f, (count - 1 - i) / 600f);
                data[i] = (low * 2.4f + noise * 0.025f + Mathf.Sin(2 * Mathf.PI * 90 * t) * 0.035f) * fade;
            }
        }
        var clip = AudioClip.Create(shatter ? "Red Logo Shatter" : "Room Background Noise", count, 1, rate, false);
        clip.SetData(data, 0);
        return clip;
    }

    void OnDestroy()
    {
        if (ambienceClip) Destroy(ambienceClip);
        if (impactClip) Destroy(impactClip);
    }
}
