import {
  createSystem,
  Euler,
  Quaternion,
  UIKit,
  UIKitMLAsset,
  Vector3,
  VisibilityState,
} from '@iwsdk/core';
import type { Object3D } from '@iwsdk/core';
import { edgeRadius, faceYaw, viewDir } from './arena-view.js';
import { getGame } from './context.js';
import type { GameContext } from './context.js';
import { BEAT_VERB, COUNTDOWN_BEATS, FIGHTER, HERO_FOR_GESTURE, HERO_LABEL } from './protocol.js';
import type { Gesture } from './protocol.js';
import { music } from './music.js';
import { rankOf, streakTitle } from './profile.js';
import { sfx } from './sfx.js';

type El = UIKit.Component;

/**
 * "Champion Arcade" HUD moods. The header itself stays navy; each phase tints
 * the round line, the call-out and the sub-line box instead.
 */
type Mood = { round: string; big: string; box: string };
const MOOD = {
  idle: { round: '#70e9d0', big: '#ffffff', box: '#e5edf0' },
  choose: { round: '#70e9d0', big: '#ffffff', box: '#e5edf0' },
  win: { round: '#70e9d0', big: '#70e9d0', box: '#e3f7f1' },
  lose: { round: '#ff8c21', big: '#ff9f42', box: '#ffe8d3' },
  draw: { round: '#ffd12c', big: '#ffffff', box: '#e5edf0' },
  victory: { round: '#ffd12c', big: '#ffd12c', box: '#fff0ba' },
} satisfies Record<string, Mood>;
/** Tutorial chips: background and border per state. */
const CHIP = {
  todo: { backgroundColor: '#e5edf0', borderColor: '#c2d3da' },
  now: { backgroundColor: '#fff0c6', borderColor: '#ff8c21' },
  done: { backgroundColor: '#bcefe2', borderColor: '#168ca7' },
};
const LOCK_PILL = { locked: '#bcefe2', waiting: '#ffe2bb' };

const HOLD = 0.6; // seconds a tutorial gesture must be held
const RAISE_HOLD = 0.5;
const SEARCH_FALLBACK = 15; // seconds before an AI rival steps in
const FORFEIT_ARM = 4; // seconds the forfeit button stays armed before resetting
const NAME_KEY = 'hca.name';
const TUTORIAL_KEY = 'hca.tutorialDone';

/**
 * Onboarding steps, in order:
 *   name -> consent -> raise -> tutorial -> calibrate -> ready
 *
 * `ready` is the resting screen the player lands on once the battlefield is
 * down. Nothing has been asked of the server yet: no match exists, no clock is
 * running, and no AI rival is on its way. Picking an option there is what starts
 * a game — `search` (matchmaking, with its own countdown to an AI stand-in) or a
 * solo match straight away. `menu` is the private-room menu, and `ended` is the
 * sign-off screen after the player ends the game from the lobby.
 */
type Stage = 'name' | 'consent' | 'raise' | 'tutorial' | 'calibrate' | 'ready' | 'search' | 'menu' | 'ended';

const TUTORIAL: { gesture: Gesture; title: string; tip: string }[] = [
  { gesture: 'rock', title: 'Make a rock', tip: 'Close your hand into a fist. Thumb in or out, both count.' },
  { gesture: 'paper', title: 'Make a paper', tip: 'Open your hand flat, fingers straight. Together or spread.' },
  { gesture: 'scissors', title: 'Make a scissors', tip: 'Index and middle finger out in a V, the others curled.' },
];

const ADJECTIVES = ['Swift', 'Stone', 'Silent', 'Brave', 'Lucky', 'Clever', 'Mighty', 'Nimble', 'Steel', 'Paper'];
const ANIMALS = ['Otter', 'Falcon', 'Tiger', 'Fox', 'Mantis', 'Panda', 'Raven', 'Lynx', 'Gecko', 'Badger'];

/**
 * Lobby onboarding flow and match HUD.
 *
 * Buttons use press-and-release instead of the pointer library's `click`,
 * which is dropped whenever a press lasts longer than 300 ms. Real hand pokes
 * and pinches regularly do, so `click` made buttons feel dead in XR.
 *
 * Before calibration the lobby floats in front of the player; afterwards both
 * panels park above the arena's far edge so they never cover the battlefield.
 */
export class UiSystem extends createSystem({}) {
  private ctx!: GameContext;
  private lobby!: UIKitMLAsset;
  private hud!: UIKitMLAsset;
  private lobbyObj!: Object3D;
  private hudObj!: Object3D;
  private el: Record<string, El> = {};
  private last = new Map<string, string>();
  private placedFor = '';
  private refloat = 0;
  private lastPress = 0;
  private lastHover = 0;
  private hovered = '';

  private stage: Stage = 'name';
  private name = '';
  /** Has the player edited the name field themselves? Drives select-on-focus. */
  private nameTouched = false;
  private agreed = false;
  private desktop = false;
  private tutorialSeen = false;
  private raiseHold = 0;
  private step = 0;
  private hold = 0;
  private celebrate = 0;
  private searchT = 0;
  private searchSent = false;
  private aiFallback = false;
  private joining = false;
  private entry = '';
  private notice = '';
  /** Seconds left on an armed forfeit; 0 means the button is back to resting. */
  private forfeitArm = 0;

  private readonly v = new Vector3();
  private readonly head = new Vector3();
  private readonly q = new Quaternion();
  private readonly tilt = new Quaternion().setFromEuler(new Euler(-0.32, 0, 0));
  private readonly yAxis = new Vector3(0, 1, 0);

  init(): void {
    this.ctx = getGame(this.world);
    this.lobby = this.world.requireSceneObject<UIKitMLAsset>('lobby-panel');
    this.hud = this.world.requireSceneObject<UIKitMLAsset>('hud-panel');
    this.lobbyObj = this.lobby;
    this.hudObj = this.hud;
    const ids = {
      lobby: [
        'lobby-eyebrow', 'lobby-title', 'lobby-status', 'lobby-hint',
        'name-row', 'name-input', 'consent-row', 'agree-box', 'agree-tick', 'agree-label',
        'tut', 'chip-rock', 'chip-paper', 'chip-scissors', 'tut-track', 'tut-fill',
        'code-row', 'code-display',
        'step-actions', 'primary-btn', 'primary-label', 'secondary-btn', 'secondary-label',
        'lobby-actions', 'create-button', 'join-button', 'ai-row', 'ai-button', 'help-button', 'back-button', 'keypad',
        'quit-row', 'quit-button',
      ],
      hud: ['hud-header', 'you-label', 'rival-label', 'you-hp', 'rival-hp', 'you-fill', 'rival-fill', 'round-text', 'hud-big', 'hud-sub', 'you-lock', 'rival-lock', 'you-lock-pill', 'rival-lock-pill', 'hud-sub-box', 'forfeit-face', 'rematch-button', 'leave-button', 'forfeit-button', 'forfeit-label', 'forfeit-cancel'],
    };
    for (const id of ids.lobby) this.el[id] = this.lobby.requireElementById(id);
    for (const id of ids.hud) this.el[id] = this.hud.requireElementById(id);
    for (const [id, e] of Object.entries(this.el)) e.name = id;

    try {
      this.name = localStorage.getItem(NAME_KEY) ?? '';
      this.tutorialSeen = localStorage.getItem(TUTORIAL_KEY) === '1';
    } catch {
      /* storage unavailable: start fresh */
    }
    this.bindNameField();
    this.setNameField(this.name);

    this.press('primary-btn', () => this.onPrimary());
    this.press('secondary-btn', () => this.onSecondary());
    this.press('agree-box', () => (this.agreed = !this.agreed));
    this.press('agree-label', () => (this.agreed = !this.agreed));
    this.press('create-button', () => {
      this.joining = false;
      this.ctx.match.message = '';
      this.ctx.net.send({ type: 'create', ready: this.ctx.arena.ready, name: this.name });
    });
    this.press('ai-button', () => this.startAi());
    this.press('help-button', () => this.startTutorial());
    this.press('back-button', () => this.startSearch());
    this.press('join-button', () => {
      this.joining = !this.joining;
      this.entry = '';
      this.ctx.match.message = '';
    });
    for (let d = 0; d <= 9; d++)
      this.press(`key-${d}`, () => {
        if (this.entry.length < 4) this.entry += String(d);
      });
    this.press('key-del', () => (this.entry = this.entry.slice(0, -1)));
    this.press('key-go', () => {
      if (this.entry.length !== 4) {
        this.ctx.match.message = 'Enter all 4 digits of the room code';
        return;
      }
      this.ctx.match.message = '';
      this.ctx.net.send({ type: 'join', code: this.entry, ready: this.ctx.arena.ready, name: this.name });
    });
    this.press('rematch-button', () => this.ctx.net.send({ type: 'rematch' }));
    // Two presses to concede: one stray poke mid-round must not end the match.
    this.press('forfeit-button', () => {
      if (this.forfeitArm > 0) {
        this.forfeitArm = 0;
        this.ctx.net.send({ type: 'forfeit' });
      } else this.forfeitArm = FORFEIT_ARM;
    });
    this.press('forfeit-cancel', () => (this.forfeitArm = 0));
    this.press('quit-button', () => this.endGame());
    this.press('leave-button', () => {
      // Back to matchmaking after a finished match.
      this.ctx.net.send({ type: 'leave' });
      this.ctx.match.phase = 'offline';
      this.startReady();
    });

    this.cleanupFuncs.push(
      this.ctx.events.on('arenaReady', () => {
        this.placedFor = '';
        if (this.stage === 'calibrate') this.startReady();
      }),
      this.ctx.events.on('state', () => (this.joining = false)),
      this.world.visibilityState.subscribe((vis) => {
        // Headset off, or the session pushed behind a system menu: hold the
        // music rather than play to an empty room. `pause` keeps the position,
        // so putting the headset back on resumes the same track.
        if (vis === VisibilityState.VisibleBlurred) music.pause();
        else if (this.stage !== 'name' && this.stage !== 'consent' && this.stage !== 'ended') music.start();
        // Deliberately does not clear `placedFor`: a blur and focus round trip
        // would otherwise re-anchor parked panels to wherever the player has
        // since moved. Entering or leaving AR changes the placement key anyway.
        // Entered AR some other way (e.g. the browser's own XR button):
        // treat it as consent and carry on with the hand steps.
        if (vis !== VisibilityState.NonImmersive && (this.stage === 'name' || this.stage === 'consent')) {
          this.commitName();
          this.agreed = true;
          this.stage = 'raise';
          this.raiseHold = 0;
        }
      }),
    );
  }

  // ------------------------------------------------------------------ input

  /**
   * Fire on press-and-release on the element, however long the press lasts.
   *
   * Every button bound here also answers to the touch: a quiet blip as a
   * fingertip or ray crosses onto it, a firmer one when the press lands. In XR
   * there is no cursor and no travel under your finger, so without a sound a
   * button that is about to take a poke feels identical to the panel around it.
   */
  private press(id: string, fn: () => void): void {
    const e = this.el[id] ?? this.lobby.requireElementById(id);
    e.name = id;
    let downId: number | null = null;
    const down = (ev: { pointerId: number }) => {
      downId = ev.pointerId;
    };
    const up = (ev: { pointerId: number }) => {
      if (downId == null || ev.pointerId !== downId) return;
      downId = null;
      const now = performance.now();
      // One action per physical press, even if poke and ray both report it.
      if (now - this.lastPress < 250) return;
      this.lastPress = now;
      sfx.tap();
      fn();
    };
    const over = () => this.hoverBlip(id);
    e.addEventListener('pointerdown', down as never);
    e.addEventListener('pointerup', up as never);
    e.addEventListener('pointerover', over as never);
    this.cleanupFuncs.push(() => {
      e.removeEventListener('pointerdown', down as never);
      e.removeEventListener('pointerup', up as never);
      e.removeEventListener('pointerover', over as never);
    });
  }

  /**
   * One hover blip per button entered.
   *
   * Nested elements report their own crossing, and a hand-held ray jitters, so
   * both the repeat and the quick re-entry of the same button are dropped.
   */
  private hoverBlip(id: string): void {
    const now = performance.now();
    if (now - this.lastHover < 90) return;
    if (id === this.hovered && now - this.lastHover < 600) return;
    this.hovered = id;
    this.lastHover = now;
    sfx.hover();
  }

  /**
   * Wire the name field once. Called from `init`, never again.
   *
   * The field is deliberately left **uncontrolled**. uikit resolves an Input's
   * text as `value ?? uncontrolledSignal ?? defaultValue ?? ''`, so setting
   * `value` pins the display to whatever we last wrote — which means the only
   * way to make typing visible is to write the value back on every keystroke.
   * That is what the old code did, and it is why typing here misbehaved:
   * `setProperties` rebuilds the component's whole reactive property set
   * (it spreads over the old input properties and calls `resetProperties`),
   * and the effect that mirrors the text into the hidden DOM input then
   * reassigns `element.value` mid-keystroke, moving the caret.
   *
   * Leaving `value` unset lets the browser's own text editing run untouched.
   * We only listen.
   */
  private bindNameField(): void {
    this.el['name-input'].setProperties({
      onValueChange: (v: string) => {
        this.name = v;
        this.nameTouched = true;
      },
      // A returning player arrives with their old name already in the box. Left
      // alone, a tap and a type appends rather than replaces -- "test" plus
      // "Nayin" really did produce "testNayin", which looked like a bug and is
      // just a caret sitting after the remembered text. Selecting that text on
      // the first focus makes the first keystroke replace it, while a later
      // click still drops a caret for editing.
      onFocusChange: (focused: boolean) => {
        if (!focused) return;
        this.nameDom ??= document.activeElement as HTMLInputElement | null;
        if (this.nameTouched) return;
        const dom = this.nameDom;
        if (dom?.value) dom.setSelectionRange(0, dom.value.length);
      },
    } as never);
  }

  /**
   * uikit's own `<input>` for the name field, or null before it is found.
   *
   * uikit backs every Input with a real offscreen `<input>` appended to
   * `document.body`, and that element -- not the UIKitML wrapper -- is where
   * the text, the caret and the selection actually live. The wrapper that
   * `requireElementById` returns forwards `setProperties` but exposes none of
   * uikit's own `currentSignal` / `focus` / `uncontrolledSignal`, so caret and
   * selection work has to address the DOM node. It is captured on first focus
   * and otherwise looked up lazily; this panel holds the app's only Input.
   */
  private nameDom: HTMLInputElement | null = null;

  private nameInput(): HTMLInputElement | null {
    this.nameDom ??= document.querySelector<HTMLInputElement>('body > input[type="text"]');
    return this.nameDom;
  }

  /**
   * Put a value in the name field from code (the remembered name, or a shuffle).
   *
   * `defaultValue` covers the field until the player types; after that only
   * `uncontrolledSignal` can override them, so both are written. Neither fires
   * `onValueChange`, hence the explicit `this.name`.
   */
  private setNameField(value: string): void {
    this.name = value;
    // `defaultValue` covers the field until the player types. Once they have,
    // uikit prefers its own stored text, and the only way to override that
    // without pinning the field to a controlled `value` is to write the DOM
    // node and let uikit's own input handler pick the change up.
    this.el['name-input'].setProperties({ defaultValue: value } as never);
    const dom = this.nameInput();
    if (dom && dom.value !== value) {
      dom.value = value;
      dom.dispatchEvent(new Event('input', { bubbles: true }));
    }
    // A shuffled name is ours, not theirs: let the next focus select it too.
    this.nameTouched = false;
  }

  /**
   * The field's live text, falling back to the mirror.
   *
   * The 16-char cap lives here rather than on each keystroke: clamping as the
   * player types would mean writing the field back, which is the thing this
   * pair of methods exists to avoid.
   */
  private readName(): string {
    const typed = this.nameInput()?.value;
    return (typed ?? this.name).trim().slice(0, 16);
  }

  private randomName(): string {
    const a = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
    const b = ANIMALS[Math.floor(Math.random() * ANIMALS.length)];
    return `${a} ${b}`;
  }

  private commitName(): void {
    // Written back so the field shows exactly what was saved: `readName`
    // trims and caps, and the player should see that, not their raw typing.
    this.setNameField(this.readName() || this.name || this.randomName());
    try {
      localStorage.setItem(NAME_KEY, this.name);
    } catch {
      /* not remembered */
    }
  }

  private immersive(): boolean {
    return this.world.visibilityState.peek() !== VisibilityState.NonImmersive;
  }

  private onPrimary(): void {
    switch (this.stage) {
      case 'name':
        this.commitName();
        this.stage = 'consent';
        this.notice = '';
        break;
      case 'consent':
        if (!this.agreed) {
          this.notice = 'Tick "I agree" first.';
          return;
        }
        this.notice = '';
        this.raiseHold = 0;
        this.stage = 'raise';
        if (!this.immersive() && this.world.xrEnabled) this.world.launchXR();
        else if (!this.world.xrEnabled) this.desktop = true;
        break;
      case 'ready':
      case 'search':
      case 'menu':
        this.startAi();
        break;
      case 'ended':
        // Back in through the door we came out of: AR needs a fresh gesture-led
        // launch, desktop can go straight to matchmaking.
        if (this.immersive()) this.startReady();
        else {
          this.agreed = true;
          this.notice = '';
          this.stage = 'consent';
        }
        break;
      default:
        break;
    }
  }

  private onSecondary(): void {
    switch (this.stage) {
      case 'name': {
        this.setNameField(this.randomName());
        break;
      }
      case 'consent':
        // Play on desktop with the keyboard instead of entering AR.
        this.desktop = true;
        this.agreed = true;
        this.startTutorial();
        break;
      case 'raise':
        this.startTutorial();
        break;
      case 'tutorial':
        this.finishTutorial();
        break;
      case 'ready':
        // The friend path is the room menu, not matchmaking: a code to share,
        // or matchmaking from in there if they would rather take anyone.
        this.ctx.match.message = '';
        this.joining = false;
        this.stage = 'menu';
        break;
      case 'search':
        this.ctx.net.send({ type: 'leave' });
        this.searchSent = false;
        this.stage = 'menu';
        this.ctx.match.phase = 'offline';
        break;
      default:
        break;
    }
  }

  private startTutorial(): void {
    this.stage = 'tutorial';
    this.step = 0;
    this.hold = 0;
    this.celebrate = 0;
  }

  private finishTutorial(): void {
    this.tutorialSeen = true;
    try {
      localStorage.setItem(TUTORIAL_KEY, '1');
    } catch {
      /* not remembered */
    }
    if (this.immersive() && !this.ctx.arena.ready) this.stage = 'calibrate';
    else this.startReady();
  }

  /**
   * Land on the resting screen with the battlefield down and nothing started.
   *
   * Training and calibration used to run straight into matchmaking, so the
   * first thing a player saw on their new table was a clock they had not
   * started and a rival on the way. Nothing is sent to the server here: the
   * match begins when the player picks how they want to play.
   */
  private startReady(): void {
    this.stage = 'ready';
    // Onboarding is behind us and the battlefield is down: from here on the
    // player is in the game, so the background tracks come up. Starting
    // earlier would play music under the consent and calibration copy, which
    // are the two screens that most need to be read rather than felt.
    music.start();
    this.searchSent = false;
    this.aiFallback = false;
    this.joining = false;
    this.ctx.match.message = '';
  }

  private startSearch(): void {
    this.stage = 'search';
    this.searchT = 0;
    this.aiFallback = false;
    this.searchSent = true;
    this.ctx.match.message = '';
    this.ctx.net.send({ type: 'quick', ready: this.ctx.arena.ready, name: this.name });
  }

  /**
   * Leave the experience from the lobby: drop the room, come out of AR and show
   * a sign-off screen that can start another session. The page itself stays
   * loaded — a web app cannot close its own tab.
   */
  private endGame(): void {
    this.ctx.net.send({ type: 'leave' });
    this.ctx.match.phase = 'offline';
    this.ctx.match.message = '';
    this.searchSent = false;
    this.joining = false;
    this.stage = 'ended';
    this.placedFor = '';
    // Left the game deliberately: drop the track as well, so coming back in
    // starts fresh rather than halfway through whatever was playing.
    music.stop();
    if (this.immersive()) this.world.exitXR();
  }

  private startAi(): void {
    this.joining = false;
    this.ctx.match.message = '';
    this.ctx.net.send({ type: 'create', ready: this.ctx.arena.ready, ai: true, name: this.name });
  }

  // ------------------------------------------------------------- rendering

  private set(id: string, props: Record<string, unknown>): void {
    const slot = `${id}|${Object.keys(props).join(',')}`;
    const key = JSON.stringify(props);
    if (this.last.get(slot) === key) return;
    this.last.set(slot, key);
    this.el[id].setProperties(props as never);
  }

  private text(id: string, text: string): void {
    this.set(id, { text });
  }

  private show(id: string, visible: boolean): void {
    const key = visible ? 'flex' : 'none';
    if (this.last.get(id + '#d') === key) return;
    this.last.set(id + '#d', key);
    this.el[id].setProperties({ display: key } as never);
  }

  update(delta: number, time: number): void {
    const dt = Math.min(delta, 0.1);
    const m = this.ctx.match;
    const immersive = this.immersive();
    const inLobby = m.phase === 'offline' || m.phase === 'waiting';
    // Server-driven stage changes: a private room waiting for its guest shows
    // the code in the menu; a quick-match room keeps searching.
    if (m.phase === 'waiting') this.stage = m.quick ? 'search' : 'menu';
    this.lobbyObj.visible = inLobby;
    this.hudObj.visible = !inLobby;
    this.place(immersive, dt, inLobby ? 'lobby' : 'hud');
    if (inLobby) this.updateLobby(immersive, dt, time);
    else {
      this.ctx.demo.pose = null;
      this.updateHud(dt);
    }
  }

  private updateLobby(immersive: boolean, dt: number, time: number): void {
    const s = this.stage;
    this.show('name-row', s === 'name');
    this.show('consent-row', s === 'consent');
    this.show('tut', s === 'tutorial');
    this.show('tut-track', s === 'tutorial' || s === 'raise');
    this.show('lobby-actions', s === 'menu' && this.ctx.match.phase === 'offline');
    this.show('ai-row', s === 'menu' && this.ctx.match.phase === 'offline' && !this.joining);
    this.show('keypad', s === 'menu' && this.joining);
    // Only offered where leaving is harmless: the resting screen, matchmaking
    // and the room menu.
    this.show('quit-row', (s === 'ready' || s === 'search' || s === 'menu') && !this.joining);
    this.show('code-row', s === 'menu' && (this.joining || this.ctx.match.phase === 'waiting'));
    this.ctx.demo.wave = false;
    this.ctx.demo.pose = null;

    let eyebrow = 'HOTHANDZ';
    let title = '';
    let status = '';
    let hint = '';
    let primary: string | null = null;
    let secondary: string | null = null;
    let progress = 0;
    // Centred everywhere except training, where the instruction is a line to
    // follow rather than a caption and reads better ranged left.
    let align = 'center';

    switch (s) {
      case 'name':
        title = "What's your name, adventurer?";
        status = 'It will float above your side of the arena.';
        hint = 'Tap the field to type, or shuffle for a hero name.';
        primary = 'Ready to Battle!';
        break;
      case 'consent':
        title = immersive ? 'Ready when you are' : 'Allow hand tracking and passthrough';
        status =
          'HotHandZ reads your hand joints to recognise gestures and shows your room through passthrough. ' +
          'Nothing is recorded or saved.';
        hint = this.notice || 'Put your controllers down, this is a hands first game.';
        this.set('agree-tick', { display: this.agreed ? 'flex' : 'none' });
        primary = 'Start';
        secondary = immersive ? null : 'Skip (play on desktop)';
        break;
      case 'raise': {
        title = 'Welcome to HotHandZ';
        this.ctx.demo.pose = 'paper';
        this.ctx.demo.wave = true;
        if (!immersive) {
          status = this.desktop ? 'Desktop mode: keys 1, 2 and 3 stand in for your hand.' : 'Waiting for AR to start...';
          if (this.desktop) {
            this.raiseHold += dt;
            if (this.raiseHold > 1.4) this.startTutorial();
          }
        } else {
          const raised = this.handRaised();
          this.raiseHold = raised ? this.raiseHold + dt : Math.max(0, this.raiseHold - dt);
          status = this.ctx.hands.left.tracked || this.ctx.hands.right.tracked
            ? 'Lift one open hand up in front of your face.'
            : 'Put your controllers down, this is a hands first game.';
          if (this.raiseHold >= RAISE_HOLD) {
            sfx.calibrated();
            this.startTutorial();
          }
        }
        progress = Math.min(1, this.raiseHold / RAISE_HOLD);
        secondary = "Let's Calibrate";
        break;
      }
      case 'tutorial': {
        const t = TUTORIAL[this.step];
        eyebrow = `TRAINING ROUND  ${this.step + 1} / ${TUTORIAL.length}`;
        title = t.title;
        this.ctx.demo.pose = t.gesture;
        const now = this.ctx.gesture.now;
        // The instruction itself is the body copy. It used to sit under a line
        // naming the fighter and its role, which said nothing a player holding
        // their hand up needs, and pushed the one thing to do into fine print.
        align = 'left';
        status = t.tip;
        hint = '';
        if (this.celebrate > 0) {
          this.celebrate -= dt;
          status = `Nice! That's ${t.gesture.toUpperCase()}.`;
          hint = this.step < TUTORIAL.length - 1 ? 'Next one...' : 'You are ready.';
          progress = 1;
          if (this.celebrate <= 0) {
            if (this.step < TUTORIAL.length - 1) {
              this.step++;
              this.hold = 0;
            } else this.finishTutorial();
          }
        } else {
          this.hold = now === t.gesture ? this.hold + dt : Math.max(0, this.hold - dt * 2);
          progress = Math.min(1, this.hold / HOLD);
          if (now && now !== t.gesture) hint = `That reads as ${now.toUpperCase()}.`;
          else if (!immersive) hint = 'Desktop: press 1 for Rock, 2 for Paper, 3 for Scissors.';
          if (this.hold >= HOLD) {
            sfx.lock();
            this.celebrate = 1.1;
            this.hold = 0;
          }
        }
        // One gesture at a time. Showing all three at once read as a menu to
        // choose from rather than a step to copy; the eyebrow's "2 / 3" and
        // the progress bar carry the sense of progress instead.
        const order: Gesture[] = ['rock', 'paper', 'scissors'];
        order.forEach((g, i) => {
          this.show(`chip-${g}`, i === this.step);
          if (i !== this.step) return;
          this.set(`chip-${g}`, this.celebrate > 0 ? CHIP.done : CHIP.now);
        });
        secondary = 'Skip training';
        break;
      }
      case 'calibrate': {
        const calib = this.ctx.calib;
        title = 'Place your battlefield';
        status = calib.state === 'holding'
          ? `Hold still... ${Math.round(calib.progress * 100)}%`
          : 'Look at a table and place both palms flat on it for 4 seconds.';
        progress = calib.state === 'holding' ? calib.progress : 0;
        break;
      }
      case 'ready': {
        // The battlefield is down and nothing is running. Waving a hand here is
        // the only thing on the table, so the demo hand keeps the arena alive
        // while the player decides.
        this.ctx.demo.pose = 'paper';
        this.ctx.demo.wave = true;
        title = 'Make a move';
        status = 'Play a solo match against an AI rival, or take on a friend.';
        hint = `${this.name || 'Challenger'}  |  ${this.rankLine()}`;
        primary = 'PLAY SOLO';
        secondary = 'PLAY WITH A FRIEND';
        break;
      }
      case 'search': {
        this.ctx.demo.pose = 'paper';
        this.ctx.demo.wave = true;
        this.searchT += dt;
        title = "We're looking for a challenger";
        const dots = '.'.repeat(1 + (Math.floor(time * 2) % 3));
        status = this.aiFallback ? 'No challenger yet. An AI rival steps into the arena!' : `PLEASE WAIT ${dots}`;
        hint = `${this.name || 'Challenger'}  |  ${this.rankLine()}`;
        if (!this.aiFallback && this.searchT > SEARCH_FALLBACK && this.ctx.match.phase === 'waiting') {
          this.aiFallback = true;
          this.startAi();
        }
        primary = 'PLAY SOLO';
        secondary = 'PLAY WITH A FRIEND';
        break;
      }
      case 'ended': {
        title = 'THANKS FOR PLAYING';
        status = this.rankLine();
        hint = this.immersive()
          ? 'Take the headset off whenever you like.'
          : 'Your progress is saved on this device.';
        primary = 'Play again';
        break;
      }
      case 'menu': {
        const m = this.ctx.match;
        if (m.phase === 'waiting') {
          title = `Room ${m.code}`;
          status = m.message || 'Share this code with your friend. Waiting for them to join...';
          this.text('code-display', m.code);
        } else {
          title = 'Play a friend';
          status = this.joining ? 'Type their 4-digit room code, then press Join.' : 'Create a room and share the code, or join theirs.';
          if (m.message) status = m.message;
          this.text('code-display', this.joining ? this.entry.padEnd(4, '-') : '----');
        }
        break;
      }
    }

    this.text('lobby-eyebrow', eyebrow);
    // Never write an empty string: a text element emptied once stops updating.
    this.show('lobby-title', title !== '');
    if (title) this.text('lobby-title', title);
    this.text('lobby-status', status);
    this.set('lobby-status', { textAlign: align });
    this.set('lobby-hint', { textAlign: align });
    this.show('lobby-hint', hint !== '');
    if (hint) this.text('lobby-hint', hint);
    this.show('step-actions', primary !== null || secondary !== null);
    this.show('primary-btn', primary !== null);
    this.show('secondary-btn', secondary !== null);
    if (primary) this.text('primary-label', primary);
    if (secondary) this.text('secondary-label', secondary);
    this.set('tut-fill', { width: Math.max(1, 428 * progress) });
    this.set('tut-fill', { backgroundColor: progress >= 1 ? '#70e9d0' : '#168ca7' });
  }

  /** "Rookie, 3 stars  |  2 wins in a row" */
  private rankLine(): string {
    const p = this.ctx.progress.profile;
    const streak = p.streak >= 2 ? '  |  ' + p.streak + ' wins in a row' : '';
    return rankOf(p.stars) + ', ' + p.stars + (p.stars === 1 ? ' star' : ' stars') + streak;
  }

  private handRaised(): boolean {
    this.player.head.getWorldPosition(this.head);
    for (const h of [this.ctx.hands.left, this.ctx.hands.right])
      if (h.tracked && h.palm.y > this.head.y - 0.3) return true;
    return false;
  }

  /** Park panels across the arena facing the player, or float the lobby pre-calibration. */
  private place(immersive: boolean, delta: number, showing: 'lobby' | 'hud'): void {
    const arena = this.ctx.arena;
    if (arena.ready && arena.object) {
      // Anchored where the player stood when the panel appeared, not re-aimed
      // every frame: a panel that chases your head is unreadable and makes the
      // table feel like it is moving. Turn your head and it stays put; it
      // re-places only when the other panel takes over, or the arena moves.
      const key = `arena:${arena.center.x.toFixed(3)},${arena.center.y.toFixed(3)},${arena.center.z.toFixed(3)},${arena.width},${arena.depth},${immersive},${showing}`;
      if (key === this.placedFor) return;
      this.placedFor = key;
      this.player.head.getWorldPosition(this.head);
      const dir = viewDir(this.ctx, this.head, this.v);
      const yaw = faceYaw(dir);
      this.q.setFromAxisAngle(this.yAxis, yaw).multiply(this.tilt);
      // Raised above the far edge: within reach, above the player's downward
      // line of sight to the battlefield. The desktop camera is framed on the
      // table, so the panels sit lower there.
      const raise = immersive ? 1 : 0.5;
      const r = edgeRadius(this.ctx, dir, 0.07);
      for (const [obj, lift] of [[this.lobbyObj, 0.4 * raise], [this.hudObj, 0.34 * raise]] as const) {
        obj.position.set(
          arena.center.x - dir.x * r,
          arena.center.y + lift,
          arena.center.z - dir.z * r,
        );
        obj.quaternion.copy(this.q);
      }
      return;
    }
    if (!immersive) return;
    // Not calibrated yet: keep the lobby comfortably in view, re-centring lazily.
    this.refloat -= delta;
    if (this.placedFor === 'float' && this.refloat > 0) return;
    this.refloat = 1.5;
    this.player.head.getWorldPosition(this.head);
    // The head looks down its local -Z. (getWorldDirection is +Z for plain
    // objects but -Z for cameras, which once parked the lobby behind the player.)
    this.player.head.getWorldQuaternion(this.q);
    this.v.set(0, 0, -1).applyQuaternion(this.q);
    const yaw = Math.atan2(-this.v.x, -this.v.z);
    const toPanelX = this.lobbyObj.position.x - this.head.x;
    const toPanelZ = this.lobbyObj.position.z - this.head.z;
    const panelYaw = Math.atan2(toPanelX, toPanelZ) + Math.PI;
    const diff = Math.abs(Math.atan2(Math.sin(yaw - panelYaw), Math.cos(yaw - panelYaw)));
    if (this.placedFor === 'float' && diff < 0.6) return;
    this.placedFor = 'float';
    // A little left of centre, leaving room for the demo hand on the right.
    this.lobbyObj.position.set(
      this.head.x - Math.sin(yaw) * 0.6 - Math.cos(yaw) * 0.08,
      this.head.y - 0.12,
      this.head.z - Math.cos(yaw) * 0.6 + Math.sin(yaw) * 0.08,
    );
    this.q.setFromAxisAngle(this.yAxis, yaw);
    this.lobbyObj.quaternion.copy(this.q);
  }

  private updateHud(dt: number): void {
    const m = this.ctx.match;
    const live = m.phase === 'countdown' || m.phase === 'choose' || m.phase === 'reveal';
    if (!live) this.forfeitArm = 0;
    else if (this.forfeitArm > 0) this.forfeitArm = Math.max(0, this.forfeitArm - dt);
    const armed = this.forfeitArm > 0;
    const max = Math.max(1, m.maxHp);
    const hp0 = Math.round(m.displayHp[0]);
    const hp1 = Math.round(m.displayHp[1]);
    this.text('you-hp', String(hp0));
    this.text('rival-hp', String(hp1));
    this.set('you-fill', { width: Math.max(0.5, (150 * hp0) / max) });
    this.set('rival-fill', { width: Math.max(0.5, (150 * hp1) / max) });
    const hot = streakTitle(this.ctx.progress.profile.streak);
    this.text('you-label', (m.names[0] || 'You').toUpperCase() + (hot ? '  ' + hot : ''));
    this.text('rival-label', (m.names[1] || (m.rivalIsAi ? 'AI Rival' : 'Rival')).toUpperCase());
    this.text('round-text', m.round > 0 ? `ROUND ${m.round}` : m.quick ? 'MATCH FOUND' : `ROOM ${m.code}`);
    this.show('rematch-button', m.phase === 'gameover' && !m.rematchRequested && m.rivalConnected);
    this.show('leave-button', m.phase === 'gameover');
    this.show('forfeit-button', live);
    this.show('forfeit-cancel', armed);
    if (live) this.text('forfeit-label', armed ? 'Confirm forfeit' : 'Forfeit');

    let big = 'VS';
    let sub = '';
    let mood: Mood = MOOD.idle;
    let youLock = '';
    let rivalLock = '';
    switch (m.phase) {
      case 'calibrating':
        sub = this.ctx.arena.ready
          ? `${m.names[1] || 'Your rival'} found! Waiting for them to place their battlefield...`
          : `${m.names[1] || 'Rival'} found! Place both palms flat on your table to begin.`;
        break;
      case 'countdown': {
        const beat = Math.ceil((m.phaseRemaining / Math.max(0.001, m.phaseDuration)) * COUNTDOWN_BEATS);
        big = beat >= 1 ? String(Math.min(COUNTDOWN_BEATS, beat)) : 'CHOOSE!';
        sub = this.ctx.time < this.ctx.progress.noticeUntil ? this.ctx.progress.notice : 'Get ready: raise a hand above the table';
        break;
      }
      case 'choose': {
        const elapsed = m.phaseDuration - m.phaseRemaining;
        big = elapsed < 0.9 ? 'CHOOSE!' : String(Math.ceil(m.phaseRemaining));
        mood = MOOD.choose;
        if (m.myPick) sub = `${FIGHTER[m.myPick].name} locked. Waiting for your rival...`;
        else if (m.candidate) sub = `${FIGHTER[m.candidate].name}: hold steady, or pinch your other hand to lock`;
        else sub = 'Fist = Rock, open hand = Paper, V = Scissors';
        youLock = m.locked[0] ? 'LOCKED' : 'CHOOSING...';
        rivalLock = m.locked[1] ? 'LOCKED' : 'CHOOSING...';
        break;
      }
      case 'reveal': {
        const r = m.lastReveal;
        if (r) {
          const mine = r.picks[0] ? heroOf(r.picks[0]) : null;
          const theirs = r.picks[1] ? heroOf(r.picks[1]) : null;
          if (r.reason === 'draw') {
            big = 'CLASH';
            mood = MOOD.draw;
            sub = mine ? `${mine} vs ${theirs}: an even clash, no damage` : 'Nobody chose. No damage';
          } else if (r.reason === 'both-no-show') {
            big = 'TOO SLOW';
            mood = MOOD.draw;
            sub = 'Nobody chose in time. No damage';
          } else if (r.winner === 0) {
            big = 'HIT!';
            mood = MOOD.win;
            sub = theirs
              ? `${banner(r.picks[0]!, r.picks[1]!)}  -${r.damage[1]}`
              : `Rival hesitated! Your ${mine} strikes their core  -${r.damage[1]}`;
          } else {
            big = 'OUCH';
            mood = MOOD.lose;
            sub = mine
              ? `${banner(r.picks[1]!, r.picks[0]!)}  -${r.damage[0]}`
              : `Too slow! Their ${theirs} strikes your core  -${r.damage[0]}`;
          }
          youLock = mine ? mine.toUpperCase() : 'NO PICK';
          rivalLock = theirs ? theirs.toUpperCase() : 'NO PICK';
        }
        break;
      }
      case 'gameover':
        big = m.forfeitedBy === 0 ? 'FORFEIT' : m.winner === 0 ? 'VICTORY' : m.winner === 1 ? 'DEFEAT' : 'DRAW';
        mood = m.winner === 0 ? MOOD.victory : m.winner === 1 ? MOOD.lose : MOOD.draw;
        sub = m.forfeitedBy === 0
          ? 'You handed this one to your rival.'
          : m.forfeitedBy === 1
          ? `${m.names[1] || 'Your rival'} forfeited. The match is yours.`
          : !m.rivalConnected
          ? 'Your rival left.'
          : m.rematchRequested
            ? 'Waiting for your rival to accept the rematch...'
            : 'Press Rematch to fight again';
        if (this.ctx.progress.lines.length) sub = this.ctx.progress.lines.join('  |  ') + '\n' + sub;
        break;
    }
    if (m.message && (m.phase === 'calibrating' || m.phase === 'gameover')) sub = m.message;
    // Armed forfeit owns the sub line: the consequence has to be unmissable.
    if (armed) {
      sub = 'Forfeiting ends the match now and gives your rival the win.';
      mood = { ...mood, box: MOOD.lose.box };
    }
    this.text('hud-big', big);
    this.text('hud-sub', sub);
    this.text('you-lock', youLock);
    this.text('rival-lock', rivalLock);
    this.show('you-lock-pill', youLock !== '');
    this.show('rival-lock-pill', rivalLock !== '');
    this.set('you-lock-pill', { backgroundColor: youLock === 'CHOOSING...' ? LOCK_PILL.waiting : LOCK_PILL.locked });
    this.set('rival-lock-pill', { backgroundColor: rivalLock === 'CHOOSING...' ? LOCK_PILL.waiting : LOCK_PILL.locked });
    this.set('round-text', { color: mood.round });
    this.set('hud-big', { color: mood.big });
    this.set('hud-sub-box', { backgroundColor: mood.box });
    // Armed forfeit turns orange so the confirming press is unmistakable.
    this.set('forfeit-face', armed
      ? { backgroundColor: '#ff8c21', borderColor: '#ffe3b3' }
      : { backgroundColor: '#202b3b', borderColor: '#202b3b' });
  }
}

/** "ROCK crushes SCISSORS" */
function banner(winner: Gesture, loser: Gesture): string {
  return `${FIGHTER[winner].name} ${BEAT_VERB[winner]} ${FIGHTER[loser].name}`;
}

function heroOf(g: Gesture): string {
  return HERO_LABEL[HERO_FOR_GESTURE[g]];
}
