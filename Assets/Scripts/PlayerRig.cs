using System.Collections.Generic;
using UnityEngine;
using UnityEngine.XR;
using UnityEngine.InputSystem;
using UnityEngine.InputSystem.Controls;
using CommonUsages = UnityEngine.XR.CommonUsages;

namespace PoorWords
{
    public sealed class PlayerRig : MonoBehaviour
    {
        public Camera view;
        public bool XRActive { get; private set; }
        public string HoverLabel { get; private set; } = "";
        public string HeldLabel {
            get { var s = ""; foreach (var h in hands) if (h.held) s += (s.Length > 0 ? " + " : "") + h.held.displayName; return s; }
        }
        sealed class Hand {
            public XRNode node;
            public Transform pose;
            public LineRenderer beam;
            public Pickup held;
            public bool trigger, grip, turn;
            public InteractionTarget hover;
            public Vector3 lastDraw;
        }
        readonly List<XRDisplaySubsystem> displays = new List<XRDisplaySubsystem>();
        readonly Hand[] hands = new Hand[2];
        CharacterController body;
        Transform tracking;
        float yaw, pitch, grabDistance = .7f;
        bool locked, menu, trackingConfigured;
        static bool Press(KeyControl key) => key != null && key.wasPressedThisFrame;
        static bool Down(KeyControl key) => key != null && key.isPressed;
        public void Build() {
            transform.position = new Vector3(0,0,-3.25f);
            body = gameObject.AddComponent<CharacterController>(); body.height=1.65f; body.radius=.19f; body.center=new Vector3(0,.83f,0); body.stepOffset=.15f;
            tracking=new GameObject("Tracking space").transform; tracking.SetParent(transform,false);
            var cameraGo=new GameObject("Player camera"); cameraGo.tag="MainCamera"; cameraGo.transform.SetParent(tracking,false);
            cameraGo.transform.localPosition=new Vector3(0,1.65f,0);
            view=cameraGo.AddComponent<Camera>(); view.nearClipPlane=.05f; view.farClipPlane=35; view.fieldOfView=70;
            view.backgroundColor=new Color(.055f,.075f,.085f);
            cameraGo.AddComponent<AudioListener>();
            for(int i=0;i<2;i++) {
                var h=new Hand {node=i==0?XRNode.LeftHand:XRNode.RightHand};
                h.pose=new GameObject(i==0?"Left hand":"Right hand").transform; h.pose.SetParent(tracking,false);
                var pointer=new GameObject("Interaction ray"); h.beam=pointer.AddComponent<LineRenderer>(); pointer.transform.SetParent(transform,false);
                h.beam.material=new Material(Shader.Find("Sprites/Default")); h.beam.startWidth=.006f; h.beam.endWidth=.002f;
                h.beam.startColor=new Color(.95f,.72f,.32f,.7f); h.beam.endColor=new Color(.95f,.72f,.32f,.15f); h.beam.positionCount=2;
                hands[i]=h;
            }
            RefreshXR();
        }
        void RefreshXR() {
            SubsystemManager.GetSubsystems(displays); XRActive=false;
            foreach(var d in displays) if(d.running) XRActive=true;
        }
        public void SetMenu(bool value) {
            menu=value;
            if(!XRActive) { locked=!value; Cursor.lockState=locked?CursorLockMode.Locked:CursorLockMode.None; Cursor.visible=!locked; }
        }
        void Update() {
            if(!view) return;
            RefreshXR();
            if(XRActive) XRUpdate(); else DesktopUpdate();
            HoverLabel="";
            foreach(var h in hands) if(h.hover) HoverLabel=h.hover.label;
            if(!string.IsNullOrEmpty(HeldLabel)) HoverLabel += "\nHolding: "+HeldLabel;
        }
        void DesktopUpdate() {
            hands[0].beam.enabled=false; hands[1].beam.enabled=false;
            var k=Keyboard.current; var m=Mouse.current;
            if(k==null || m==null) return;
            if(Press(k.escapeKey)) { GalleryGame.Instance.ToggleMenu(); return; }
            if(menu || !GalleryGame.Instance.State.Started) return;
            if(!locked) SetMenu(false);
            var delta=m.delta.ReadValue(); yaw+=delta.x*.11f; pitch=Mathf.Clamp(pitch-delta.y*.11f,-78,78);
            transform.rotation=Quaternion.Euler(0,yaw,0); view.transform.localRotation=Quaternion.Euler(pitch,0,0);
            view.transform.localPosition=new Vector3(0,Down(k.cKey)?1.15f:1.65f,0);
            Vector3 move = transform.right*((Down(k.dKey)?1:0)-(Down(k.aKey)?1:0)) + transform.forward*((Down(k.wKey)?1:0)-(Down(k.sKey)?1:0));
            body.Move((Vector3.ClampMagnitude(move,1)*2.0f+Vector3.down*2)*Time.deltaTime);
            var h=hands[1]; h.pose.SetPositionAndRotation(view.transform.position+view.transform.forward*grabDistance+view.transform.right*.18f-view.transform.up*.15f,view.transform.rotation);
            if(h.held) {
                h.held.transform.SetPositionAndRotation(h.pose.position,h.pose.rotation*Quaternion.Euler(0,0,Down(k.rKey)?90:0));
                if(Press(k.fKey)) Drop(h);
                grabDistance=Mathf.Clamp(grabDistance+m.scroll.ReadValue().y*.0006f,.35f,1.5f);
            }
            if(Press(k.hKey)) GalleryGame.Instance.Hint();
            if(Press(k.tKey)) GalleryGame.Instance.Replay();
            if(Press(k.backspaceKey)) GalleryGame.Instance.ReturnTools();
            if(Press(k.tabKey)) GalleryGame.Instance.ToggleJournal();
            TickPointer(h,new Ray(view.transform.position,view.transform.forward),m.leftButton.wasPressedThisFrame,m.leftButton.isPressed);
        }
        void XRUpdate() {
            if(!trackingConfigured) {
                var inputs=new List<XRInputSubsystem>();SubsystemManager.GetSubsystems(inputs);
                foreach(var subsystem in inputs) if(subsystem.running) {
                    tracking.localPosition=subsystem.TrySetTrackingOriginMode(TrackingOriginModeFlags.Floor)?Vector3.zero:new Vector3(0,1.6f,0);
                    trackingConfigured=true;
                }
            }
            var head=InputDevices.GetDeviceAtXRNode(XRNode.Head);
            if(head.TryGetFeatureValue(CommonUsages.devicePosition,out Vector3 hp)) view.transform.localPosition=hp;
            if(head.TryGetFeatureValue(CommonUsages.deviceRotation,out Quaternion hr)) view.transform.localRotation=hr;
            for(int i=0;i<2;i++) {
                var h=hands[i]; var dev=InputDevices.GetDeviceAtXRNode(h.node);
                if(!dev.isValid) { h.beam.enabled=false; continue; }
                if(dev.TryGetFeatureValue(CommonUsages.devicePosition,out Vector3 p)) h.pose.localPosition=p;
                if(dev.TryGetFeatureValue(CommonUsages.deviceRotation,out Quaternion r)) h.pose.localRotation=r;
                dev.TryGetFeatureValue(CommonUsages.triggerButton,out bool trigger);
                dev.TryGetFeatureValue(CommonUsages.gripButton,out bool grip);
                dev.TryGetFeatureValue(CommonUsages.primary2DAxis,out Vector2 stick);
                if(!menu && GalleryGame.Instance.State.Started) {
                    if(i==0) {
                        Vector3 forward=Vector3.ProjectOnPlane(view.transform.forward,Vector3.up).normalized;
                        body.Move((forward*stick.y+Vector3.Cross(Vector3.up,forward)*stick.x)*Time.deltaTime*1.5f);
                    } else {
                        if(Mathf.Abs(stick.x)>.7f && !h.turn) {
                            transform.RotateAround(view.transform.position,Vector3.up,Mathf.Sign(stick.x)*30); h.turn=true;
                        }
                        if(Mathf.Abs(stick.x)<.3f) h.turn=false;
                    }
                }
                if(grip && !h.grip && GalleryGame.Instance.State.Started) {
                    var close=Physics.OverlapSphere(h.pose.position,.20f); Pickup found=null;
                    foreach(var c in close) { var item=c.GetComponentInParent<Pickup>(); if(item && !item.Locked && !item.Held) {found=item;break;} }
                    if(found && !h.held) Take(h,found);
                    else if(!h.held && Physics.Raycast(h.pose.position,h.pose.forward,out var hit,4)) { var item=hit.collider.GetComponentInParent<Pickup>(); if(item) Take(h,item); }
                }
                if(!grip && h.grip && h.held) Drop(h);
                if(h.held) h.held.transform.SetPositionAndRotation(h.pose.position+h.pose.forward*.12f,h.pose.rotation*Quaternion.Euler(65,0,0));
                TickPointer(h,new Ray(h.pose.position,h.pose.forward),trigger&&!h.trigger,trigger);
                h.trigger=trigger; h.grip=grip;
            }
            if(!menu) body.Move(Vector3.down*Time.deltaTime);
        }
        void TickPointer(Hand h,Ray ray,bool pressed,bool held) {
            // Ignore held-tool colliders so the pointer always reaches the target.
            var hits=Physics.RaycastAll(ray,5f); System.Array.Sort(hits,(a,b)=>a.distance.CompareTo(b.distance));
            InteractionTarget target=null; Pickup pickup=null; Vector3 point=ray.GetPoint(4);
            foreach(var hit in hits) {
                var item=hit.collider.GetComponentInParent<Pickup>();
                if(item && item.Held) continue;
                target=hit.collider.GetComponentInParent<InteractionTarget>(); pickup=item; point=hit.point; break;
            }
            if(h.hover!=target) { if(h.hover) h.hover.Hover(false); h.hover=target; if(target) target.Hover(true); }
            h.beam.enabled=XRActive; h.beam.SetPosition(0,ray.origin); h.beam.SetPosition(1,point);
            if(target && held && h.held && h.held.tool==Tool.Charcoal && (target.kind==TargetKind.Board || target.kind==TargetKind.Frame)) {
                if(Vector3.Distance(point,h.lastDraw)>.008f) { GalleryGame.Instance.Draw(target,point); h.lastDraw=point; }
            }
            if(!pressed) return;
            if(pickup && !h.held && GalleryGame.Instance.State.Started) { Take(h,pickup); return; }
            if(target) GalleryGame.Instance.Use(target,h.held);
        }
        void Take(Hand h,Pickup p) {
            if(!p.Take()) return;
            foreach(var collider in p.GetComponentsInChildren<Collider>()) Physics.IgnoreCollision(collider,body,true);
            h.held=p;
        }
        void Drop(Hand h) {
            var p=h.held; h.held=null; if(!p) return;
            if(p.tool==Tool.DrawnSword && Vector3.Distance(p.transform.position,GalleryGame.Instance.World.bridgePosition)<.55f) GalleryGame.Instance.Dock(p);
            p.Release();
        }
        public void Forget(Pickup p) { foreach(var h in hands) if(h.held==p) h.held=null; }
        public void ReturnTools() { foreach(var h in hands) { if(h.held) {var p=h.held; h.held=null;p.Release();p.ReturnHome();} } }
        void OnDisable() { Cursor.lockState=CursorLockMode.None;Cursor.visible=true; }
    }
}
