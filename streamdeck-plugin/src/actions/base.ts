import type { JsonObject } from "@elgato/utils";
import { SingletonAction, type DialAction, type KeyAction, type WillAppearEvent, type WillDisappearEvent, type DidReceiveSettingsEvent } from "@elgato/streamdeck";
import streamDeck from "@elgato/streamdeck";

import type { CommandResult } from "../client";
import { engine, type Refreshable, type RenderContext } from "../engine";
import { keySvg, type KeyImage } from "../image";

export type Surface<S extends JsonObject> = KeyAction<S> | DialAction<S>;

/**
 * Base for all actions: tracks visible instances, redraws them from backend state, and
 * only sends an image when it changed.
 */
export abstract class PadAction<S extends JsonObject = JsonObject> extends SingletonAction<S> implements Refreshable {
	protected visible = new Map<string, { action: Surface<S>; settings: S; last?: string }>();
	protected lastCtx: RenderContext | null = null;

	constructor() {
		super();
		engine.register(this);
	}

	/** What this key should look like right now. */
	protected abstract view(settings: S, ctx: RenderContext, id: string): KeyImage;

	override onWillAppear(ev: WillAppearEvent<S>): void {
		this.visible.set(ev.action.id, { action: ev.action as Surface<S>, settings: ev.payload.settings });
		engine.refresh(true);
	}

	override onWillDisappear(ev: WillDisappearEvent<S>): void {
		this.visible.delete(ev.action.id);
		this.disappeared(ev.action.id);
	}

	override onDidReceiveSettings(ev: DidReceiveSettingsEvent<S>): void {
		const v = this.visible.get(ev.action.id);
		if (v) v.settings = ev.payload.settings;
		engine.refresh(true);
	}

	protected disappeared(_id: string): void {
		/* hook for subclasses */
	}

	protected settingsOf(id: string): S {
		return (this.visible.get(id)?.settings ?? {}) as S;
	}

	refresh(ctx: RenderContext): void {
		this.lastCtx = ctx;
		for (const [id, v] of this.visible) {
			const svg = keySvg(this.view(v.settings, ctx, id));
			if (svg !== v.last) {
				v.last = svg;
				void v.action.setImage(svg);
			}
			this.afterRender(id, v.action, ctx);
		}
	}

	protected afterRender(_id: string, _action: Surface<S>, _ctx: RenderContext): void {
		/* hook for subclasses (e.g. touch strip feedback) */
	}

	/** Run a backend command; on failure show the alert indicator and log why. */
	protected async run(action: Surface<S>, what: string, p: Promise<CommandResult>): Promise<boolean> {
		const res = await p;
		if (!res.ok) {
			streamDeck.logger.warn(`${what} failed: ${res.error}`);
			await action.showAlert();
		}
		engine.refresh(true);
		return res.ok;
	}
}
