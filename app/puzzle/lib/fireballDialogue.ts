import { RESCUE_SCRIPT } from './rescueScript';

/** Summon during the first line, then finish the catch line before release. */
export async function playFireballDialogue(
  transition: Promise<void>,
  speak: (id: string, text: string) => Promise<void>,
  isCurrent: () => boolean,
) {
  const preparation = RESCUE_SCRIPT.find(beat => beat.id === 'rope')!;
  const catchLine = RESCUE_SCRIPT.find(beat => beat.id === 'catch-fireball')!;
  await Promise.all([transition, speak(preparation.id, preparation.text)]);
  if (isCurrent()) await speak(catchLine.id, catchLine.text);
}
