using NUnit.Framework;

namespace PoorWords.Tests
{
    public sealed class PuzzleStateTests
    {
        PuzzleState state;
        [SetUp] public void Setup() {state=new PuzzleState();state.Start();}
        void ToKnight() {state.BreakSilence(Tool.Hammer);state.DrawSword();state.CutRibbon(Tool.DrawnSword);}
        void ToBridge() {ToKnight();state.ToggleLetter(0);state.ResolveNight();}
        [Test] public void CompleteRescueRequiresAllFivePuzzlesInOrder() {
            int changes=0;state.Changed+=_=>changes++;
            Assert.IsTrue(state.BreakSilence(Tool.Hammer));
            Assert.IsTrue(state.DrawSword());Assert.IsTrue(state.CutRibbon(Tool.DrawnSword));
            state.ToggleLetter(0);Assert.AreEqual("NIGHT",state.Word);Assert.IsTrue(state.ResolveNight());
            Assert.IsTrue(state.DockSword(Tool.DrawnSword));Assert.IsTrue(state.LowerBridge());
            Assert.IsTrue(state.MakeDoor(true,true));Assert.IsTrue(state.OpenDoor());
            Assert.AreEqual(Chapter.Rescued,state.Chapter);Assert.AreEqual(6,changes);
        }
        [Test] public void NoActionCanAdvanceBeforeStarting() {
            var fresh=new PuzzleState();Assert.IsFalse(fresh.BreakSilence(Tool.Hammer));Assert.IsFalse(fresh.DrawSword());
            Assert.IsFalse(fresh.ToggleLetter(0));Assert.AreEqual(Chapter.Muted,fresh.Chapter);
        }
        [Test] public void PhysicalSwordCannotCutArtOrMakeBridge() {
            state.BreakSilence(Tool.Hammer);state.DrawSword();Assert.IsFalse(state.CutRibbon(Tool.RealSword));
            state.CutRibbon(Tool.DrawnSword);state.ToggleLetter(0);state.ResolveNight();
            Assert.IsFalse(state.DockSword(Tool.RealSword));Assert.IsFalse(state.LowerBridge());
        }
        [Test] public void DuplicateSuccessDoesNotSkipChapters() {
            Assert.IsTrue(state.BreakSilence(Tool.Hammer));Assert.IsFalse(state.BreakSilence(Tool.Hammer));
            Assert.AreEqual(Chapter.VoiceReleased,state.Chapter);state.DrawSword();Assert.IsFalse(state.DrawSword());
            Assert.IsTrue(state.CutRibbon(Tool.DrawnSword));Assert.IsFalse(state.CutRibbon(Tool.DrawnSword));
        }
        [Test] public void EarlyLetterSolutionIsRememberedUntilKnightAppears() {
            state.ToggleLetter(0);Assert.AreEqual("NIGHT",state.Word);Assert.IsFalse(state.ResolveNight());
            ToKnight();Assert.IsTrue(state.ResolveNight());Assert.IsFalse(state.ToggleLetter(1));
        }
        [Test] public void MissingMultipleLettersIsNotTheSolution() {
            ToKnight();state.ToggleLetter(0);state.ToggleLetter(1);Assert.AreEqual("IGHT",state.Word);Assert.IsFalse(state.ResolveNight());
            state.ToggleLetter(1);Assert.IsTrue(state.ResolveNight());
        }
        [Test] public void EveryRemovedLetterCanBeReturnedAndInvalidSlotsAreIgnored() {
            for(int i=0;i<6;i++) state.ToggleLetter(i);Assert.AreEqual("",state.Word);
            for(int i=0;i<6;i++) state.ToggleLetter(i);Assert.AreEqual("KNIGHT",state.Word);
            Assert.IsFalse(state.ToggleLetter(-1));Assert.IsFalse(state.ToggleLetter(6));
        }
        [Test] public void BridgeRequiresPlacementThenCrankAndCannotDockTwice() {
            ToBridge();Assert.IsFalse(state.LowerBridge());Assert.IsTrue(state.DockSword(Tool.DrawnSword));
            Assert.IsFalse(state.DockSword(Tool.DrawnSword));Assert.IsTrue(state.LowerBridge());Assert.IsFalse(state.LowerBridge());
        }
        [Test] public void DoorRequiresBothPerimeterAndHandleBeforeOpening() {
            ToBridge();state.DockSword(Tool.DrawnSword);state.LowerBridge();
            Assert.IsFalse(state.OpenDoor());Assert.IsFalse(state.MakeDoor(true,false));Assert.IsFalse(state.MakeDoor(false,true));
            Assert.IsTrue(state.MakeDoor(true,true));Assert.IsTrue(state.OpenDoor());Assert.IsFalse(state.OpenDoor());
        }
        [Test] public void TracingOneEdgeRepeatedlyCannotCompletePerimeter() {
            var trace=new TraceCoverage();for(int n=0;n<10;n++) for(int i=0;i<=20;i++) trace.Add(-.5f+i/20f,.5f);
            Assert.IsFalse(trace.Complete);
        }
        [Test] public void CoarseTraceInEitherDirectionCompletesAllFourEdges() {
            var trace=new TraceCoverage();for(int i=0;i<=12;i++) {float p=.5f-i/12f;
                trace.Add(p,.5f);trace.Add(p,-.5f);trace.Add(.5f,p);trace.Add(-.5f,p);
            }Assert.IsTrue(trace.Complete);trace.Clear();Assert.IsFalse(trace.Complete);
        }
        [Test] public void ProgressCannotReachOneHundredPercentWithAMissingEdge() {
            var trace=new TraceCoverage();for(int i=0;i<=30;i++) {float p=-.5f+i/30f;
                trace.Add(p,.5f);trace.Add(p,-.5f);trace.Add(-.5f,p);
            }
            Assert.IsFalse(trace.Complete);Assert.Less(trace.Progress,1f);
        }
        [Test] public void InteriorScribblesDoNotCountAsAFrame() {
            var trace=new TraceCoverage();for(int i=0;i<100;i++) trace.Add(.1f,.1f);
            Assert.AreEqual(0,trace.Count);Assert.IsFalse(trace.Complete);
        }
    }
}
