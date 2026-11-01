import streamDeck from "@elgato/streamdeck";

import {
	InclineDownAction, InclineUpAction, PauseAction, PresetAction, SpeedDownAction, SpeedUpAction,
	StartAction, StopAction,
} from "./actions/controls";
import { DialAction, StatAction, TodayAction } from "./actions/stats";
import { engine } from "./engine";

streamDeck.logger.setLevel("info");

// Nothing here ever sends a command: the belt is only started by an explicit key press (see StartAction).
for (const a of [
	new StartAction(), new StopAction(), new PauseAction(), new SpeedUpAction(), new SpeedDownAction(),
	new PresetAction(), new InclineUpAction(), new InclineDownAction(), new StatAction(), new TodayAction(),
	new DialAction(),
]) {
	streamDeck.actions.registerAction(a);
}

streamDeck.connect().then(() => engine.init());
