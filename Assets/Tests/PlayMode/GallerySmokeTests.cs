using System.Collections;
using NUnit.Framework;
using UnityEngine;
using UnityEngine.TestTools;

namespace PoorWords.Tests
{
    public sealed class GallerySmokeTests
    {
        [UnityTest] public IEnumerator ActualTargetsAndDrawingsCanCompleteTheGallery() {
            var game=Object.FindFirstObjectByType<GalleryGame>();
            if(!game) game=new GameObject("Smoke test gallery").AddComponent<GalleryGame>();
            yield return null;
            game.Begin();
            Pickup hammer=null,pencil=null;
            foreach(var p in Object.FindObjectsByType<Pickup>(FindObjectsSortMode.None)) {
                if(p.tool==Tool.Hammer) hammer=p;if(p.tool==Tool.Charcoal) pencil=p;
            }
            Assert.IsNotNull(hammer);Assert.IsNotNull(pencil);
            InteractionTarget plaque=null;
            foreach(var t in Object.FindObjectsByType<InteractionTarget>(FindObjectsSortMode.None)) if(t.kind==TargetKind.Plaque) plaque=t;
            Assert.IsNotNull(plaque);game.Use(plaque,hammer);Assert.AreEqual(Chapter.VoiceReleased,game.State.Chapter);
            // Draw the guide in the board's own rotated coordinates, then use the resulting object.
            var board=game.World.board;
            for(int i=0;i<=20;i++) DrawAt(game,board,0,-.15f+i*.028f);
            for(int i=0;i<=20;i++) DrawAt(game,board,-.23f+i*.023f,-.21f);
            Assert.IsTrue(game.State.SwordDrawn);Assert.IsNotNull(game.World.sword);
            game.Use(game.World.ribbon.GetComponent<InteractionTarget>(),game.World.sword);
            Assert.AreEqual(Chapter.RibbonRemoved,game.State.Chapter);
            game.Use(game.World.letters[0].GetComponent<InteractionTarget>(),null);
            Assert.AreEqual(Chapter.NightEstablished,game.State.Chapter);
            game.Dock(game.World.sword);Assert.IsTrue(game.State.SwordDocked);
            InteractionTarget crank=null;
            foreach(var t in Object.FindObjectsByType<InteractionTarget>(FindObjectsSortMode.None)) if(t.kind==TargetKind.Crank) crank=t;
            game.Use(crank,null);Assert.AreEqual(Chapter.BridgeCrossed,game.State.Chapter);
            var frame=game.World.frame;
            for(int i=0;i<=30;i++) {float v=-.5f+i/30f;
                DrawAt(game,frame,v,.5f);DrawAt(game,frame,v,-.5f);DrawAt(game,frame,.5f,v);DrawAt(game,frame,-.5f,v);
            }
            for(int i=0;i<12;i++) DrawAt(game,frame,.46f,-.04f+i*.008f);
            Assert.AreEqual(Chapter.DoorCreated,game.State.Chapter);Assert.IsTrue(game.World.doorHandle.activeSelf);
            game.Use(game.World.doorHandle.GetComponent<InteractionTarget>(),null);
            yield return new WaitForSeconds(4);
            Assert.AreEqual(Chapter.Rescued,game.State.Chapter);Assert.IsTrue(game.World.princess.gameObject.activeSelf);
            Assert.AreEqual(game.World.root,game.World.hinge.parent,"The voice handoff must not reparent the painting.");
            Object.Destroy(game.World.root.gameObject);
            Object.Destroy(Object.FindFirstObjectByType<PlayerRig>().gameObject);
            Object.Destroy(game.gameObject);
            yield return null;
        }
        static void DrawAt(GalleryGame game,InteractionTarget surface,float x,float y) {
            game.Draw(surface,surface.transform.TransformPoint(new Vector3(x*surface.drawSize.x,y*surface.drawSize.y,-.035f)));
        }
    }
}
