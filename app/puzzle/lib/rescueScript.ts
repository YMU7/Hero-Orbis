import beats from './rescueDialogue.json';
export type RescueBeat = typeof beats[number];
export const RESCUE_SCRIPT = beats;
export type RescueStage = 'silence' | 'unmuted' | 'melted' | 'drawn' | 'rope' | 'fire' | 'key' | 'rejected' | 'photo' | 'escaped';

