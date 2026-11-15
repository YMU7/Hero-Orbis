using UnityEngine;
using UnityEngine.Rendering;

namespace PoorWords
{
    // Graybox art intentionally uses Unity's stock meshes plus a public-domain portrait.
    public sealed class GalleryBuilder
    {
        public readonly Transform root;
        public Transform hinge, princess;
        public GameObject canvas, ribbon, knight, gate, moon, smallBridge, bridgeSocket, doorHandle, mouthSeal, tinyDoor, insideDoor;
        public GameObject[] letters = new GameObject[6];
        public TextMesh[] letterLabels = new TextMesh[6];
        public TextMesh status, objective, subtitle, prompt, bellCard, wordLabel;
        public InteractionTarget board, frame;
        public Pickup sword;
        public LineRenderer silenceCue;
        public Light mainLight;
        public Material charcoal, gold, paper, red, teal, metal, dark, wood;
        public Vector3 bridgePosition = new Vector3(0, .94f, .57f);
        public GalleryBuilder() {
            root = new GameObject("The Royal Gallery").transform;
            gold = Mat("Aged brass", new Color(.61f,.40f,.14f), .65f);
            charcoal = Mat("Charcoal", new Color(.055f,.06f,.075f));
            paper = Mat("Restoration paper", new Color(.83f,.76f,.60f));
            red = Mat("Crimson ribbon", new Color(.5f,.025f,.05f));
            teal = Mat("Royal teal", new Color(.06f,.24f,.24f));
            metal = Mat("Unhelpfully real steel", new Color(.53f,.61f,.65f), .8f);
            dark = Mat("Ink", new Color(.026f,.039f,.05f));
            wood = Mat("Walnut", new Color(.18f,.09f,.05f));
            Room(); Painting(); Bench(); Props(); Signage();
        }
        public static Material Mat(string name, Color color, float metallic = 0) {
            var m = new Material(Shader.Find("Standard")) { name = name, color = color };
            m.SetFloat("_Metallic", metallic); m.SetFloat("_Glossiness", .25f); return m;
        }
        public GameObject Shape(string name, PrimitiveType shape, Vector3 pos, Vector3 size, Material mat, Transform parent = null, bool collider = true) {
            var go = new GameObject(name); go.transform.SetParent(parent ? parent : root, false);
            go.transform.localPosition = pos;
            var mesh = GameObject.CreatePrimitive(shape); mesh.name = name + " mesh"; mesh.transform.SetParent(go.transform, false);
            mesh.transform.localScale = size; mesh.GetComponent<Renderer>().sharedMaterial = mat;
            Object.Destroy(mesh.GetComponent<Collider>());
            if (collider) { var hit = go.AddComponent<BoxCollider>(); hit.size = size; if (shape == PrimitiveType.Quad) hit.size = new Vector3(size.x,size.y,.025f); }
            return go;
        }
        public GameObject Box(string name, Vector3 pos, Vector3 size, Material mat, Transform parent = null, bool collider = true) => Shape(name, PrimitiveType.Cube, pos, size, mat, parent, collider);
        public TextMesh Text(string value, Vector3 pos, float size = .065f, Color? color = null, Transform parent = null) {
            var go = new GameObject(value.Length > 22 ? value.Substring(0,22) : value); go.transform.SetParent(parent ? parent : root, false); go.transform.localPosition = pos;
            var t = go.AddComponent<TextMesh>(); t.text = value; t.font = Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf");
            t.GetComponent<Renderer>().sharedMaterial = t.font.material;
            t.fontSize = 64; t.characterSize = size; t.anchor = TextAnchor.MiddleCenter; t.alignment = TextAlignment.Center; t.color = color ?? new Color(.88f,.81f,.64f);
            return t;
        }
        public InteractionTarget Target(GameObject go, TargetKind kind, string label, int index = 0) { var t = go.AddComponent<InteractionTarget>(); t.Configure(kind,label,index); return t; }
        void Room() {
            RenderSettings.ambientLight = new Color(.20f,.23f,.27f);
            RenderSettings.fog = true; RenderSettings.fogColor = new Color(.065f,.085f,.09f); RenderSettings.fogDensity = .014f;
            var floor = Mat("Stone floor",new Color(.22f,.24f,.23f)); var wall = Mat("Gallery plaster",new Color(.12f,.18f,.17f));
            Box("Floor",new Vector3(0,-.12f,0),new Vector3(10,.24f,10),floor);
            Box("Back wall",new Vector3(0,2.3f,4.7f),new Vector3(10,4.6f,.2f),wall);
            Box("Left wall",new Vector3(-4.8f,2.3f,0),new Vector3(.2f,4.6f,10),wall);
            Box("Right wall",new Vector3(4.8f,2.3f,0),new Vector3(.2f,4.6f,10),wall);
            Box("Entrance wall",new Vector3(0,2.3f,-4.8f),new Vector3(10,4.6f,.2f),wall);
            for(int x=-4;x<=4;x++) for(int z=-4;z<=4;z++) {
                Box("Floor joint",new Vector3(x,.004f,z),new Vector3(.016f,.006f,.95f),dark,null,false);
                Box("Floor joint",new Vector3(x,.004f,z),new Vector3(.95f,.006f,.016f),dark,null,false);
            }
            Box("Runner",new Vector3(0,.012f,-1.2f),new Vector3(2.7f,.012f,5.9f),red,null,false);
            for(int x=-1;x<=1;x+=2) {
                Box("Runner border",new Vector3(x*1.25f,.023f,-1.2f),new Vector3(.025f,.008f,5.9f),gold,null,false);
                for(int z=-3;z<5;z+=3) {
                    Shape("Column",PrimitiveType.Cylinder,new Vector3(x*4.45f,1.8f,z),new Vector3(.3f,1.8f,.3f),paper);
                    Box("Capital",new Vector3(x*4.45f,3.6f,z),new Vector3(.5f,.15f,.5f),gold);
                }
                var lightGo = new GameObject("Warm gallery light"); lightGo.transform.SetParent(root); lightGo.transform.position = new Vector3(x*2.4f,3.3f,-1);
                var l = lightGo.AddComponent<Light>(); l.type=LightType.Point; l.color=new Color(1,.77f,.49f); l.intensity=2.6f; l.range=7;
            }
            var key = new GameObject("Moon and afternoon light"); key.transform.SetParent(root); key.transform.rotation=Quaternion.Euler(38,-25,0);
            mainLight=key.AddComponent<Light>(); mainLight.type=LightType.Directional; mainLight.intensity=.65f; mainLight.color=new Color(1,.89f,.71f);
            mainLight.shadows=LightShadows.Soft;
        }
        void Painting() {
            // Origin at the left hinge; the whole assembly opens around that edge.
            hinge = new GameObject("Painting becomes a door").transform; hinge.SetParent(root); hinge.position=new Vector3(-1.1f,1.9f,.9f);
            Box("Door backing",new Vector3(1.1f,0,.055f),new Vector3(2.2f,2.7f,.12f),wood,hinge);
            var portrait = Mat("Public domain princess portrait",Color.white); portrait.mainTexture=Resources.Load<Texture2D>("Art/Princess");
            canvas=Shape("Princess portrait",PrimitiveType.Quad,new Vector3(1.1f,0,-.018f),new Vector3(2.05f,2.55f,1),portrait,hinge);
            Target(canvas,TargetKind.Painting,"The trapped princess");
            for(int s=-1;s<=1;s+=2) {
                Box("Frame upright",new Vector3(1.1f+s*1.14f,0,-.07f),new Vector3(.15f,2.96f,.18f),gold,hinge);
                Box("Frame rail",new Vector3(1.1f,s*1.405f,-.07f),new Vector3(2.42f,.15f,.18f),gold,hinge);
                Shape("Hinge ornament",PrimitiveType.Cylinder,new Vector3(-.045f,s*.82f,-.14f),new Vector3(.09f,.16f,.09f),metal,hinge,false);
                Box("Gallery stand",new Vector3(s*1.3f,.62f,1.08f),new Vector3(.10f,1.24f,.12f),gold);
                Box("Stand foot",new Vector3(s*1.3f,.07f,1.08f),new Vector3(.5f,.14f,.55f),wood);
            }
            Box("Handle recess",new Vector3(2.15f,0,-.18f),new Vector3(.16f,.35f,.05f),dark,hinge,false);
            var trace = new GameObject("Trace the outside of the frame"); trace.transform.SetParent(hinge,false); trace.transform.localPosition = new Vector3(1.1f,0,-.20f);
            var c=trace.AddComponent<BoxCollider>(); c.size=new Vector3(2.55f,3.05f,.035f);
            frame=Target(trace,TargetKind.Frame,"Charcoal: trace frame and draw a handle"); frame.drawSize=new Vector2(2.28f,2.81f);
            // The trace collider is enabled only during the last puzzle.
            c.enabled=false;
            ribbon=Box("Painted red ribbon",new Vector3(1.1f,.25f,-.10f),new Vector3(2.03f,.14f,.035f),red,hinge);
            ribbon.transform.localRotation=Quaternion.Euler(0,0,-12); Target(ribbon,TargetKind.Ribbon,"Cut the painted ribbon");
            mouthSeal=Box("Silenced mouth seal",new Vector3(1.1f,-.84f,-.12f),new Vector3(.55f,.26f,.025f),gold,hinge,false);
            Text("X",new Vector3(0,0,-.025f),.12f,dark.color,mouthSeal.transform);
            knight=new GameObject("The day shift knight"); knight.transform.SetParent(hinge,false); knight.transform.localPosition=new Vector3(1.1f,-.65f,-.19f);
            var body=Box("Knight body",new Vector3(0,.10f,0),new Vector3(.28f,.36f,.06f),metal,knight.transform);
            Target(body,TargetKind.Knight,"Defeat the knight");
            Shape("Helmet",PrimitiveType.Sphere,new Vector3(0,.4f,0),new Vector3(.27f,.26f,.08f),metal,knight.transform,false);
            Box("Visor",new Vector3(0,.42f,-.055f),new Vector3(.20f,.025f,.012f),dark,knight.transform,false);
            Text("DAY SHIFT",new Vector3(0,.04f,-.045f),.025f,dark.color,knight.transform);
            knight.SetActive(false);
            gate=Box("Painted gate",new Vector3(1.1f,-.57f,-.09f),new Vector3(.66f,.86f,.025f),dark,hinge,false); gate.SetActive(false);
            moon=Shape("Moon",PrimitiveType.Sphere,new Vector3(1.85f,1.04f,-.08f),new Vector3(.20f,.20f,.035f),paper,hinge,false); moon.SetActive(false);
            insideDoor=Box("Door inside the picture",new Vector3(1.1f,0,-.25f),new Vector3(.55f,.85f,.04f),wood,hinge,false);
            Text("MORE\nPICTURE",new Vector3(0,0,-.025f),.06f,paper.color,insideDoor.transform);insideDoor.SetActive(false);
            doorHandle=Shape("Drawn door handle",PrimitiveType.Sphere,new Vector3(2.15f,0,-.30f),new Vector3(.15f,.15f,.15f),charcoal,hinge);
            Target(doorHandle,TargetKind.Handle,"Pull the handle / open the painting"); doorHandle.SetActive(false);
            // Shelf and brackets remain outside the moving door.
            Box("Working shelf",new Vector3(0,.78f,.56f),new Vector3(2.5f,.08f,.43f),wood);
            for(int s=-1;s<=1;s+=2) Box("Charcoal bridge support",new Vector3(s*.38f,.86f,.57f),new Vector3(.12f,.13f,.22f),charcoal);
            bridgeSocket=Box("Bridge snap area",new Vector3(0,.92f,.57f),new Vector3(1.10f,.12f,.27f),teal);
            Target(bridgeSocket,TargetKind.Bridge,"Lay the drawn sword across the supports");
            smallBridge=Box("A bridge for biscuits",new Vector3(0,1.04f,.46f),new Vector3(.16f,.025f,.07f),wood,null,false); smallBridge.SetActive(false);
            var crank=Shape("Drawbridge crank",PrimitiveType.Cylinder,new Vector3(1.50f,1.1f,.70f),new Vector3(.20f,.05f,.20f),gold);
            crank.transform.rotation=Quaternion.Euler(90,0,0); Target(crank,TargetKind.Crank,"Turn the DRAWBRIDGE crank");
            Text("DRAWBRIDGE",new Vector3(1.5f,.87f,.51f),.04f);
            Text("ONLY ART MAY ALTER ART",new Vector3(0,.47f,.32f),.045f);
            var letterPanel=Box("Removable nameplate",new Vector3(0,3.56f,.85f),new Vector3(2.35f,.37f,.10f),wood);
            for(int i=0;i<6;i++) {
                letters[i]=Box("Letter "+"KNIGHT"[i],new Vector3(-.86f+i*.345f,3.56f,.755f),new Vector3(.29f,.28f,.075f),gold);
                Target(letters[i],TargetKind.Letter,"Remove / return "+"KNIGHT"[i],i);
                letterLabels[i]=Text("KNIGHT"[i].ToString(),new Vector3(0,0,-.045f),.1f,dark.color,letters[i].transform);
            }
            wordLabel=Text("",new Vector3(0,3.86f,.7f),.045f);
        }
        void Bench() {
            Box("Restoration bench",new Vector3(-2.65f,.88f,-.1f),new Vector3(1.9f,.12f,1.05f),wood);
            for(int s=-1;s<=1;s+=2) Box("Bench leg",new Vector3(-2.65f+s*.73f,.42f,-.1f),new Vector3(.13f,.84f,.7f),wood);
            var panel=Box("Drawing board",new Vector3(-2.65f,1.47f,.18f),new Vector3(1.32f,.88f,.06f),paper);
            panel.transform.rotation=Quaternion.Euler(12,0,0);
            board=Target(panel,TargetKind.Board,"Draw with charcoal"); board.drawSize=new Vector2(1.32f,.88f);
            Text("RESTORATION",new Vector3(-2.65f,2.10f,.1f),.07f);
            Text("Charcoal studies welcome",new Vector3(-2.65f,.65f,-.65f),.04f);
            // Faint authored sword guide; not an image-recognition task.
            var guide=Mat("Faint underdrawing",new Color(.60f,.56f,.45f));
            Box("Blade underdrawing",new Vector3(0,.05f,-.038f),new Vector3(.025f,.60f,.006f),guide,panel.transform,false);
            Box("Guard underdrawing",new Vector3(0,-.18f,-.038f),new Vector3(.43f,.018f,.006f),guide,panel.transform,false);
            tinyDoor=Box("Lovely door wrong prison",new Vector3(-2.15f,1.19f,-.23f),new Vector3(.24f,.42f,.045f),wood,null,false);
            Text("EXIT",new Vector3(0,.05f,-.03f),.04f,paper.color,tinyDoor.transform); tinyDoor.SetActive(false);
        }
        Pickup Prop(string name, Tool tool, Vector3 pos, Vector3 tip) {
            var go=new GameObject(name); go.transform.SetParent(root); go.transform.position=pos;
            var pickup=go.AddComponent<Pickup>(); pickup.Setup(tool,name,tip); return pickup;
        }
        public Pickup CreateSword(bool drawn) {
            var p=Prop(drawn?"Charcoal sword":"Real sword",drawn?Tool.DrawnSword:Tool.RealSword,drawn?new Vector3(-2.65f,1.06f,-.4f):new Vector3(2.6f,1.38f,.05f),new Vector3(0,.61f,0));
            var m=drawn?charcoal:metal;
            Box("Blade",new Vector3(0,.27f,0),new Vector3(.065f,.72f,drawn?.018f:.035f),m,p.transform);
            Box("Crossguard",new Vector3(0,-.12f,0),new Vector3(.34f,.055f,.06f),drawn?charcoal:gold,p.transform);
            Box("Hilt",new Vector3(0,-.24f,0),new Vector3(.055f,.22f,.055f),wood,p.transform);
            if(drawn) {
                p.transform.rotation=Quaternion.Euler(0,0,90);p.homeRotation=p.transform.rotation;
                sword=p;
            }
            return p;
        }
        void Props() {
            var hammer=Prop("Small restoration hammer",Tool.Hammer,new Vector3(-3.2f,1.11f,-.30f),new Vector3(0,.18f,0));
            Box("Hammer shaft",Vector3.zero,new Vector3(.055f,.36f,.055f),wood,hammer.transform);
            Box("Hammer head",new Vector3(0,.18f,0),new Vector3(.25f,.11f,.10f),metal,hammer.transform);
            var pencil=Prop("Charcoal pencil",Tool.Charcoal,new Vector3(-2.20f,1.05f,-.40f),new Vector3(0,.19f,0));
            Box("Charcoal stick",Vector3.zero,new Vector3(.04f,.38f,.04f),charcoal,pencil.transform);
            pencil.transform.rotation=Quaternion.Euler(90,0,0);pencil.homeRotation=pencil.transform.rotation;
            CreateSword(false);
            Box("Letter catch tray",new Vector3(2.65f,.85f,-.35f),new Vector3(1.85f,.06f,.35f),wood);
            Box("Sword display plinth",new Vector3(2.65f,.4f,.05f),new Vector3(.6f,.8f,.6f),wood);
            Text("A PERFECTLY GOOD SWORD",new Vector3(2.65f,1.98f,-.02f),.045f);
            var plaque=Box("Ceramic SILENCE plaque",new Vector3(-.70f,1.17f,-.62f),new Vector3(.82f,.29f,.065f),paper);
            Target(plaque,TargetKind.Plaque,"SILENCE / strike with hammer");
            Text("SILENCE",new Vector3(0,0,-.04f),.064f,dark.color,plaque.transform);
            var cue=new GameObject("Mute seal points toward SILENCE");cue.transform.SetParent(root,false);
            silenceCue=cue.AddComponent<LineRenderer>();silenceCue.material=new Material(Shader.Find("Sprites/Default"));
            silenceCue.startWidth=.012f;silenceCue.endWidth=.025f;silenceCue.positionCount=3;
            silenceCue.SetPosition(0,new Vector3(0,1.06f,.72f));silenceCue.SetPosition(1,new Vector3(-.4f,1.35f,-.1f));silenceCue.SetPosition(2,plaque.transform.position+Vector3.back*.05f);
            silenceCue.startColor=new Color(1,.73f,.3f,.75f);silenceCue.endColor=new Color(1,.73f,.3f,.1f);silenceCue.enabled=false;
            var bell=Shape("Visitor bell",PrimitiveType.Sphere,new Vector3(.7f,1.16f,-.60f),new Vector3(.19f,.14f,.19f),gold);
            Target(bell,TargetKind.Bell,"Ring for assistance");
            Text("RING FOR ASSISTANCE",new Vector3(.70f,.98f,-.71f),.03f);
            bellCard=Text("",new Vector3(.75f,1.47f,-.72f),.031f);
            Box("Visitors pedestal",new Vector3(0,.50f,-.55f),new Vector3(2.0f,1.0f,.45f),wood);
        }
        void Signage() {
            Text("A POOR CHOICE\nOF WORDS",new Vector3(0,3.55f,4.56f),.22f);
            Text("A ROYAL GALLERY  /  A LITERAL CURSE",new Vector3(0,2.86f,4.53f),.055f);
            status=Text("",new Vector3(0,4.15f,.7f),.08f);
            objective=Text("",new Vector3(0,.26f,-.84f),.035f);
            var helpPos=new Vector3(2.6f,1.2f,-1.85f);
            Box("Visitor services",helpPos,new Vector3(1.4f,1.6f,.12f),wood);
            Text("VISITOR SERVICES",helpPos+new Vector3(0,.65f,-.08f),.05f);
            Button("BEGIN / CONTINUE",helpPos+new Vector3(0,.40f,-.10f),TargetKind.Start);
            Button("A LITTLE HINT",helpPos+new Vector3(0,.12f,-.10f),TargetKind.Hint);
            Button("TRACE ASSIST",helpPos+new Vector3(0,-.16f,-.10f),TargetKind.Assist);
            Button("RETURN LOST TOOLS",helpPos+new Vector3(0,-.44f,-.10f),TargetKind.ResetTools);
            Text("GRIP: TAKE / RELEASE\nTRIGGER: USE / DRAW\nLEFT STICK: MOVE\nRIGHT STICK: SNAP TURN",new Vector3(-2.5f,1.8f,-2.2f),.05f);
        }
        void Button(string label,Vector3 pos,TargetKind kind) {
            var go=Box(label,pos,new Vector3(1.15f,.21f,.045f),teal); Target(go,kind,label);
            Text(label,new Vector3(0,0,-.03f),.038f,null,go.transform);
        }
        public void SpawnPrincess() {
            princess=new GameObject("Iris - rescued graybox stand-in").transform; princess.SetParent(root); princess.position=new Vector3(0,0,1.05f);
            Shape("Dress",PrimitiveType.Capsule,new Vector3(0,.85f,0),new Vector3(.50f,.55f,.38f),teal,princess,false);
            Shape("Head",PrimitiveType.Sphere,new Vector3(0,1.57f,0),new Vector3(.25f,.29f,.25f),paper,princess,false);
            Shape("Hair",PrimitiveType.Sphere,new Vector3(0,1.66f,.04f),new Vector3(.28f,.19f,.26f),charcoal,princess,false);
            Box("Crown",new Vector3(0,1.8f,0),new Vector3(.27f,.07f,.23f),gold,princess,false);
            for(int s=-1;s<=1;s+=2) {
                Shape("Sleeve",PrimitiveType.Capsule,new Vector3(s*.28f,1.14f,0),new Vector3(.12f,.25f,.12f),paper,princess,false);
                Shape("Eye",PrimitiveType.Sphere,new Vector3(s*.048f,1.59f,-.119f),new Vector3(.025f,.025f,.015f),dark,princess,false);
            }
        }
    }
}
