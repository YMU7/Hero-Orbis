using System.Collections;
using System.Collections.Generic;
using System.Text;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace PoorWords
{
    public sealed class GalleryGame : MonoBehaviour
    {
        public static GalleryGame Instance { get; private set; }
        public PuzzleState State { get; private set; }
        public GalleryBuilder World { get; private set; }
        public bool IsXR => rig && rig.XRActive;
        public bool TraceAssist { get; private set; }
        PlayerRig rig;
        DialogueDirector dialogue;
        AudioSource effects;
        readonly TraceCoverage perimeter = new TraceCoverage(), boardDoor = new TraceCoverage(), interiorDoor = new TraceCoverage();
        readonly List<Vector3> strokePoints = new List<Vector3>();
        LineRenderer stroke;
        InteractionTarget lastSurface;
        float lastDrawTime, activity, sessionStart, bladeMin = 1, bladeMax = -1, guardMin = 1, guardMax = -1;
        float handleDistance;
        int hintLevel;
        bool menu = true, journal, doorAnimating;
        string notice = "", lastStage = "";
        float noticeUntil;
        TextMesh vrSubtitle, vrPrompt;
        Vector2 journalScroll;
        GUIStyle titleStyle, bodyStyle, smallStyle, subStyle, buttonStyle;
        public readonly string[] ChapterNames = { "01 / BREAK THE SILENCE", "02 / DRAW YOUR SWORD", "03 / DEFEAT THE KNIGHT", "04 / LOWER THE DRAWBRIDGE", "05 / DRAW A WAY OUT", "05 / OPEN THE PAINTING", "THE END / A BETTER INTERPRETATION" };
        readonly string[] objectives = { "The princess is trying to speak.", "Only art may alter art.", "A knight guards the way.", "Something drawn could span the gap.", "The whole picture is her prison.", "Pull the charcoal handle.", "Princess rescued." };
        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.AfterSceneLoad)]
        static void Bootstrap() {
            if (FindFirstObjectByType<GalleryGame>()) return;
            new GameObject("A Poor Choice of Words").AddComponent<GalleryGame>();
        }
        void Awake() {
            Instance=this; State=new PuzzleState();
            World=new GalleryBuilder();
            var voiceObject=new GameObject("Iris voice");voiceObject.transform.SetParent(World.hinge,false);
            voiceObject.transform.localPosition=new Vector3(1.1f,0,0);
            dialogue=voiceObject.AddComponent<DialogueDirector>();
            effects=gameObject.AddComponent<AudioSource>(); effects.volume=.6f;
            rig=new GameObject("Player / desktop and OpenXR").AddComponent<PlayerRig>(); rig.Build();
            // VR-readable subtitles and a gaze-independent pointer prompt.
            vrSubtitle=World.Text("",new Vector3(0,-.38f,1.7f),.027f,Color.white,rig.view.transform);
            vrPrompt=World.Text("",new Vector3(0,-.60f,1.7f),.018f,null,rig.view.transform);
            State.Changed+=StageChanged; activity=Time.time;
            Application.targetFrameRate=90;
            rig.SetMenu(true);
            Notice("Welcome to the royal gallery.",8);
        }
        public void Begin() {
            if(!State.Started) { State.Start(); sessionStart=Time.time; activity=Time.time; Sfx("latch"); }
            menu=false; activity=Time.time; rig.SetMenu(false);
        }
        public void ToggleMenu() { menu=!menu; rig.SetMenu(menu); }
        public void ToggleJournal() { journal=!journal; menu=journal; rig.SetMenu(menu); }
        public void Replay() => dialogue.Replay();
        public void ReturnTools() {
            rig.ReturnTools();
            foreach(var p in FindObjectsByType<Pickup>(FindObjectsSortMode.None)) p.ReturnHome();
            Notice("Tools returned to their stations.");
        }
        public void Dock(Pickup sword) {
            if(State.DockSword(sword.tool)) {
                rig.Forget(sword);
                sword.LockAt(World.bridgePosition,Quaternion.Euler(0,0,90));
                World.bridgeSocket.SetActive(false);
                dialogue.Story("sword_bridge","lower"); Sfx("magic"); Touch();
            }
        }
        public void Use(InteractionTarget target,Pickup item) {
            if(!target) return;
            if(target.kind==TargetKind.Start) {Begin();return;}
            if(target.kind==TargetKind.Hint) {Hint();return;}
            if(target.kind==TargetKind.Assist) {TraceAssist=!TraceAssist;Notice("Trace assist "+(TraceAssist?"ON":"OFF")+". Draw on each needed area.");return;}
            if(target.kind==TargetKind.ResetTools) {ReturnTools();return;}
            if(!State.Started || doorAnimating) return;
            Touch();
            Tool tool=item?item.tool:Tool.None;
            switch(target.kind) {
                case TargetKind.Bell:
                    State.RingBell(); Sfx("click"); World.bellCard.text="ASSISTANCE IS ALSO\nOBSERVING THE SILENCE."; break;
                case TargetKind.Plaque:
                    if(State.BreakSilence(tool)) {
                        target.gameObject.SetActive(false); World.mouthSeal.SetActive(false); Shatter(target.transform.position); Sfx("ceramic");
                    } else if(State.Chapter==Chapter.Muted) Notice("The ceramic plaque looks rather fragile."); break;
                case TargetKind.Ribbon:
                    if(State.CutRibbon(tool)) {World.ribbon.SetActive(false);Sfx("cut");}
                    else if(tool==Tool.RealSword && State.Chapter==Chapter.VoiceReleased) Joke(State.Attempts.Contains("real_sword")?"real_repeat":"real_sword");
                    else if(tool!=Tool.None && State.Chapter>Chapter.Muted) Joke("art");
                    break;
                case TargetKind.Knight:
                    if(State.Chapter==Chapter.RibbonRemoved) {
                        if(tool==Tool.DrawnSword) {Joke("combat");StartCoroutine(KnightBlock());}
                        else if(tool==Tool.RealSword) Joke("still_real");
                    } break;
                case TargetKind.Letter:
                    if(State.ToggleLetter(target.index)) {
                        UpdateLetters();Sfx("click");
                        if(State.Chapter==Chapter.RibbonRemoved && !State.ResolveNight()) Joke(State.Word.Length==0?"letters_empty":"letters_wrong");
                    } else Notice("The word is fixed by the curse.");
                    break;
                case TargetKind.Board:
                    if(tool!=Tool.Charcoal) Notice("Pick up the charcoal. Hold the trigger or mouse button to draw.");
                    break;
                case TargetKind.Bridge:
                    if(State.Chapter==Chapter.NightEstablished) {
                        if(item && tool==Tool.DrawnSword) Dock(item);
                        else if(tool==Tool.RealSword) Joke("art");
                        else Notice("Lay something drawn across the two charcoal brackets.");
                    } break;
                case TargetKind.Crank:
                    if(!State.LowerBridge()) {
                        if(State.Chapter>=Chapter.VoiceReleased && State.Chapter<=Chapter.NightEstablished) Joke("early_crank");
                        StartCoroutine(TinyBridge());
                    } else { Sfx("squeak"); StartCoroutine(CrossBridge()); }
                    break;
                case TargetKind.Frame:
                    if(tool!=Tool.Charcoal && State.Chapter==Chapter.BridgeCrossed) Notice("The outer frame has hinges. The recess could hold a handle.");
                    break;
                case TargetKind.Handle:
                    if(State.OpenDoor()) {Sfx("latch");StartCoroutine(Rescue());} break;
                case TargetKind.Painting:
                    if(tool==Tool.Hammer || tool==Tool.RealSword) {
                        Sfx("reject"); Notice(State.Chapter==Chapter.Muted?"A painted hand presses back: STOP.":"ONLY ART MAY ALTER ART");
                    }
                    else if(tool==Tool.Charcoal && State.Chapter==Chapter.BridgeCrossed) Notice("The charcoal can mark the picture and its frame.");
                    break;
            }
        }
        void UpdateLetters() {
            for(int i=0;i<6;i++) {
                // Removed letters remain in the catch tray and can always be returned.
                World.letters[i].transform.position=State.Letters[i]?new Vector3(-.86f+i*.345f,3.56f,.755f):new Vector3(1.95f+i*.27f,1.02f,-.35f);
            }
            World.wordLabel.text=State.Word.Length==0?"(unemployed punctuation)":State.Word;
        }
        public void Draw(InteractionTarget surface,Vector3 point) {
            if(!State.Started || doorAnimating) return;
            Touch();
            Vector3 local=surface.transform.InverseTransformPoint(point);
            float x=local.x/surface.drawSize.x, y=local.y/surface.drawSize.y;
            if(surface.kind==TargetKind.Frame && State.Chapter==Chapter.BridgeCrossed) {
                if(Mathf.Abs(x)<.37f && Mathf.Abs(y)<.37f) {
                    interiorDoor.Add(x/.45f,y/.5f);AddInk(surface,point);
                    if(interiorDoor.Complete) {Joke("inside_door");if(!World.insideDoor.activeSelf) StartCoroutine(ShowInsideDoor());}
                    return;
                }
                perimeter.Add(x,y);
                if(TraceAssist && (Mathf.Abs(x)>.37f || Mathf.Abs(y)>.37f)) {
                    // Assist still requires touching all four sides, then drawing the handle.
                    for(int i=0;i<=12;i++) {
                        float v=-.5f+i/12f;
                        if(y>.37f) perimeter.Add(v,.5f); if(y<-.37f) perimeter.Add(v,-.5f);
                        if(x>.37f) perimeter.Add(.5f,v); if(x<-.37f) perimeter.Add(-.5f,v);
                    }
                }
                if(x>.425f && x<.48f && Mathf.Abs(y)<.09f) handleDistance+=.025f;
                if(perimeter.Count>2) Joke("frame");
                Notice("Frame trace: "+Mathf.RoundToInt(perimeter.Progress*100)+"%  /  Handle: "+(handleDistance>.15f?"drawn":"missing"),1);
                AddInk(surface,point);
                if(State.MakeDoor(perimeter.Complete,handleDistance>.15f)) {
                    surface.GetComponent<Collider>().enabled=false; World.doorHandle.SetActive(true); Sfx("magic");
                }
                return;
            }
            if(surface.kind!=TargetKind.Board) return;
            if(State.Chapter==Chapter.Muted) {Notice("A faint sword study. First, find a way to release her voice.");return;}
            if(State.Chapter==Chapter.NightEstablished) Joke("new_bridge");
            AddInk(surface,point);
            if(State.Chapter==Chapter.VoiceReleased && !State.SwordDrawn) {
                Joke("drawing");
                if(Mathf.Abs(x)<.14f && y>-.18f && y<.46f) {bladeMin=Mathf.Min(bladeMin,y);bladeMax=Mathf.Max(bladeMax,y);}
                if(y>-.34f && y<-.09f) {guardMin=Mathf.Min(guardMin,x);guardMax=Mathf.Max(guardMax,x);}
                if(TraceAssist) {
                    if(Mathf.Abs(x)<.14f) {bladeMin=-.15f;bladeMax=.4f;}
                    if(y>-.34f && y<-.09f && Mathf.Abs(x)>.14f) {guardMin=-.2f;guardMax=.2f;}
                }
                if(bladeMax-bladeMin>.39f && guardMax-guardMin>.24f && State.DrawSword()) {
                    World.CreateSword(true); dialogue.Story("extract"); Sfx("magic"); Notice("A charcoal sword lifts from the page. Pick it up.",7);
                }
            }
            if(State.Chapter==Chapter.BridgeCrossed) {
                boardDoor.Add(x/.72f,y/.82f);
                if(boardDoor.Complete && !World.tinyDoor.activeSelf) {World.tinyDoor.SetActive(true);Joke("wrong_door");Sfx("latch");}
            }
        }
        void AddInk(InteractionTarget surface,Vector3 point) {
            if(lastSurface!=surface || Time.time-lastDrawTime>.15f || strokePoints.Count>250 || (strokePoints.Count>0 && Vector3.Distance(strokePoints[strokePoints.Count-1],point)>.15f)) {
                strokePoints.Clear(); var go=new GameObject("Charcoal stroke"); go.transform.SetParent(surface.transform,false);
                stroke=go.AddComponent<LineRenderer>(); stroke.useWorldSpace=false; stroke.material=World.charcoal;
                stroke.startWidth=.012f;stroke.endWidth=.012f;stroke.numCapVertices=3;lastSurface=surface;
            }
            // Offset toward the viewer to avoid z-fighting with the board.
            point-=surface.transform.forward*.025f;
            strokePoints.Add(point);stroke.positionCount=strokePoints.Count;
            for(int i=0;i<strokePoints.Count;i++) stroke.SetPosition(i,surface.transform.InverseTransformPoint(strokePoints[i]));
            lastDrawTime=Time.time;
        }
        void StageChanged(Chapter stage) {
            hintLevel=0; Touch(); lastStage=stage.ToString();
            Debug.Log("[Puzzle] "+stage+" @ "+(Time.time-sessionStart).ToString("F1")+"s");
            Sfx("magic");
            switch(stage) {
                case Chapter.VoiceReleased:
                    dialogue.Story("voice",State.BellRung?"bell_thanks":"hammer_thanks","intro","draw_request"); break;
                case Chapter.RibbonRemoved:
                    World.ribbon.SetActive(false); World.knight.SetActive(true);World.gate.SetActive(true);
                    dialogue.Story("cut","knight_intro");
                    // Honor a valid early discovery, after entry staging is committed.
                    StartCoroutine(ResolveEarlyWord()); break;
                case Chapter.NightEstablished:
                    World.moon.SetActive(true);World.gate.SetActive(false);
                    World.mainLight.color=new Color(.43f,.59f,1);World.mainLight.intensity=.45f;
                    World.canvas.GetComponentInChildren<Renderer>().material.color=new Color(.61f,.71f,1);
                    World.knight.transform.localRotation=Quaternion.Euler(0,0,78);
                    World.wordLabel.text="NIGHT / DAY SHIFT ENDED";
                    dialogue.Story("night","rule","bridge_request");break;
                case Chapter.BridgeCrossed:
                    dialogue.Story("crossed","door_request");
                    World.frame.GetComponent<Collider>().enabled=true; break;
                case Chapter.DoorCreated:
                    dialogue.Story("handle");break;
                case Chapter.Rescued:
                    dialogue.Story("open");break;
            }
        }
        IEnumerator ResolveEarlyWord() {yield return null;State.ResolveNight();}
        IEnumerator KnightBlock() {
            var t=World.knight.transform;var p=t.localPosition;t.localPosition=p+Vector3.back*.035f;
            yield return new WaitForSeconds(.16f);t.localPosition=p;
        }
        IEnumerator ShowInsideDoor() {World.insideDoor.SetActive(true);Sfx("latch");yield return new WaitForSeconds(3);World.insideDoor.SetActive(false);}
        IEnumerator TinyBridge() {World.smallBridge.SetActive(true);Sfx("squeak");yield return new WaitForSeconds(2);World.smallBridge.SetActive(false);}
        IEnumerator CrossBridge() {
            // The portrait remains a still. Foreground geometry communicates all puzzle changes.
            if(World.sword) {
                var t=World.sword.transform;var p=t.position;var q=p+Vector3.down*.08f+Vector3.forward*.16f;
                for(float t0=0;t0<1;t0+=Time.deltaTime) {t.position=Vector3.Lerp(p,q,t0);yield return null;}
            }
            Notice("Iris reaches the edge of the painting.",5);
        }
        IEnumerator Rescue() {
            doorAnimating=true; World.SpawnPrincess(); World.princess.gameObject.SetActive(false);
            Quaternion start=World.hinge.rotation, end=start*Quaternion.Euler(0,-100,0);
            for(float t=0;t<1;t+=Time.deltaTime/1.6f) {World.hinge.rotation=Quaternion.Slerp(start,end,Mathf.SmoothStep(0,1,t));yield return null;}
            World.hinge.rotation=end;
            // Hide the placeholder portrait once Iris has physically emerged.
            World.canvas.SetActive(false); World.knight.SetActive(false); World.ribbon.SetActive(false);
            World.princess.gameObject.SetActive(true);
            var p=World.princess.position;
            for(float t=0;t<1;t+=Time.deltaTime/2) {World.princess.position=Vector3.Lerp(p,new Vector3(.45f,0,-.10f),t);yield return null;}
            dialogue.transform.SetParent(World.princess,true);dialogue.transform.localPosition=new Vector3(0,1.5f,0);
            dialogue.Story("brave","equipped","keep");doorAnimating=false;
        }
        void Joke(string id) {
            if(State.Attempts.Contains(id)) return;
            if(dialogue.Optional(id)) State.FirstAttempt(id);
        }
        public void Hint() {
            if(!State.Started) {Notice("Choose Begin to enter the gallery.");return;}
            int chapter=(int)State.Chapter;
            if(chapter==0) {
                Notice(hintLevel==0?"Look below the painting: SILENCE is written on a ceramic plaque.":"Pick up the hammer and strike the SILENCE plaque.",10);
            } else if(chapter<6) {
                if(!dialogue.Optional("hint_"+chapter+"_"+(chapter==5?0:Mathf.Min(hintLevel,2)))) return;
                if(chapter==1 && State.SwordDrawn) Notice("Take the drawn sword and cut the red ribbon.",10);
                if(chapter==3 && State.SwordDocked) Notice("Turn the crank to lower the drawn bridge.",10);
            }
            hintLevel++;activity=Time.time;
        }
        void Touch() { activity=Time.time; }
        void Notice(string text,float seconds=4) {notice=text;noticeUntil=Time.time+seconds;}
        void Sfx(string id) {var clip=Resources.Load<AudioClip>("Audio/"+id);if(clip) effects.PlayOneShot(clip);}
        void Shatter(Vector3 p) {
            for(int i=0;i<9;i++) {
                var shard=World.Box("Ceramic shard",p+Random.insideUnitSphere*.1f,new Vector3(.07f,.055f,.02f),World.paper);
                shard.AddComponent<Rigidbody>().AddForce((Random.insideUnitSphere+Vector3.up)*1.2f,ForceMode.Impulse);
                Destroy(shard,6);
            }
        }
        void Update() {
            if(!rig) return;
            int c=(int)State.Chapter;
            World.silenceCue.enabled=State.Started && c==0 && Time.time-activity>20 && Mathf.Sin(Time.time*3)>-.3f;
            World.status.text=ChapterNames[c];World.objective.text=objectives[c];
            string overlay=Time.time<noticeUntil?notice:"";
            vrSubtitle.text=Wrap(dialogue.Subtitle,70);
            vrPrompt.text=Wrap(IsXR?overlay+"\n"+rig.HoverLabel:"",78);
            // Desktop renders subtitles through OnGUI; avoid drawing two copies.
            vrSubtitle.gameObject.SetActive(IsXR);vrPrompt.gameObject.SetActive(IsXR);
            if(State.Started && c<6 && !menu && Time.time-activity>45 && !dialogue.Busy) Hint();
        }
        static string Wrap(string value,int width) {
            var output=new StringBuilder();int n=0;
            foreach(var word in value.Split(' ')) {if(n+word.Length>width) {output.Append('\n');n=0;}output.Append(word).Append(' ');n+=word.Length+1;}
            return output.ToString().Trim();
        }
        void Styles() {
            if(titleStyle!=null) return;
            titleStyle=new GUIStyle(GUI.skin.label){fontSize=42,fontStyle=FontStyle.Bold,wordWrap=true};titleStyle.normal.textColor=new Color(.94f,.83f,.59f);
            bodyStyle=new GUIStyle(GUI.skin.label){fontSize=19,wordWrap=true};bodyStyle.normal.textColor=new Color(.84f,.86f,.82f);
            smallStyle=new GUIStyle(bodyStyle){fontSize=14};smallStyle.normal.textColor=new Color(.66f,.70f,.68f);
            subStyle=new GUIStyle(bodyStyle){alignment=TextAnchor.MiddleCenter,fontSize=22};
            buttonStyle=new GUIStyle(GUI.skin.button){fontSize=18,padding=new RectOffset(16,16,10,10)};
        }
        void OnGUI() {
            if(IsXR) return;Styles();
            float scale=Mathf.Min(Screen.width/1280f,Screen.height/800f);GUI.matrix=Matrix4x4.TRS(Vector3.zero,Quaternion.identity,Vector3.one*scale);
            float w=Screen.width/scale,h=Screen.height/scale;
            GUI.Label(new Rect(28,24,700,32),ChapterNames[(int)State.Chapter],bodyStyle);
            GUI.Label(new Rect(28,59,700,28),objectives[(int)State.Chapter],smallStyle);
            if(!menu && !journal) {
                GUI.Label(new Rect(w/2-7,h/2-14,20,28),"+",bodyStyle);
                GUI.Label(new Rect(30,h-74,730,60),rig.HoverLabel,smallStyle);
                GUI.Label(new Rect(w-340,24,315,64),"H  Hint     T  Repeat     Esc  Menu\nF  Drop     R  Rotate     Tab  Transcript",smallStyle);
            }
            if(Time.time<noticeUntil) GUI.Box(new Rect(w/2-340,102,680,60),"");
            if(Time.time<noticeUntil) GUI.Label(new Rect(w/2-324,110,648,52),notice,bodyStyle);
            if(!string.IsNullOrEmpty(dialogue.Subtitle)) {
                GUI.Box(new Rect(w/2-460,h-170,920,85),"");
                GUI.Label(new Rect(w/2-440,h-164,880,78),"IRIS   /   "+dialogue.Subtitle,subStyle);
            }
            if(menu || journal) {
                GUI.Box(new Rect(w/2-345,175,690,h-350),"");
                GUILayout.BeginArea(new Rect(w/2-315,194,630,h-390));
                if(journal) {
                    GUILayout.Label("THE CONVERSATION",titleStyle);
                    journalScroll=GUILayout.BeginScrollView(journalScroll);
                    foreach(var line in dialogue.Transcript) GUILayout.Label(line,bodyStyle);
                    GUILayout.EndScrollView();
                    if(GUILayout.Button("Back to the gallery",buttonStyle)) {journal=false;menu=false;rig.SetMenu(false);}
                } else {
                    GUILayout.Label("A Poor Choice\nof Words",titleStyle);
                    GUILayout.Label("A royal gallery. A trapped princess.\nA curse with an unfortunate grasp of language.",bodyStyle);
                    GUILayout.Space(12);
                    GUILayout.Label("WASD to move · Mouse to look · C to crouch\nClick to take / use · Hold click with charcoal to draw\nF to drop · R to rotate · Scroll to adjust tool distance",smallStyle);
                    GUILayout.Space(12);
                    if(GUILayout.Button(State.Started?"Return to the gallery":"Enter the gallery",buttonStyle)) Begin();
                    GUILayout.BeginHorizontal();
                    if(GUILayout.Button("A little hint",buttonStyle)) Hint();
                    if(GUILayout.Button("Return tools",buttonStyle)) ReturnTools();
                    GUILayout.EndHorizontal();
                    TraceAssist=GUILayout.Toggle(TraceAssist,"  Trace assist (larger, forgiving drawing regions)");
                    dialogue.Muted=GUILayout.Toggle(dialogue.Muted,"  Mute Iris (subtitles remain on)");
                    if(State.Started && GUILayout.Button("Read the conversation",buttonStyle)) journal=true;
                    if(State.Chapter==Chapter.Rescued && GUILayout.Button("Play again",buttonStyle)) SceneManager.LoadScene(SceneManager.GetActiveScene().buildIndex);
                }
                GUILayout.EndArea();
            }
        }
    }
}
