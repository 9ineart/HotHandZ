# Hand Clash: game design (studio pass)

Status: proposal. Nothing in this document is built unless section 1 says so.

## 1. Where the build is today

Built and tested in the emulator: onboarding (name, consent, raise hand, gesture
tutorial), table calibration, Rock / Paper / Scissors recognition with
hold-to-lock, hidden picks, a server-run match (100 HP, countdown, reveal,
damage), matchmaking with an AI fallback, private rooms, and three hand
sculptures as fighters.

Conflicts between the current build and this brief:

| Brief says | Build has | Action |
|---|---|---|
| No magic | Paper attacks with a shield bubble and energy orbs; "summon" beams; orbiting cards | Replace with Palm Push and a physical deflect |
| Athletes (gloves, tape, belts) | Stone, paper and steel sculptures | Re-skin as fighters; keep stone/paper/steel as unlockable skins |
| Room is the arena | Tabletop arena only | Keep the table as the ring for MVP; floor scale in Version 3 |

## 2. Critique: the main weaknesses

1. **The fight does not matter yet.** The throw decides everything, so
   "heavyweight" and "speed fighter" are costumes. Fix: section 4.
2. **Pinch-to-confirm breaks the gesture.** Pinching with the throwing hand
   turns Rock, Paper or Scissors into a different pose. Fix: hold to lock, or
   pinch with the *other* hand (section 3).
3. **Levels that unlock stronger moves are pay-to-win by time.** A Level 10
   Rock beating a Level 1 Rock breaks the fairness that makes the game
   readable. Fix: levels unlock *how* a move looks, never its numbers.
4. **Voice and floor-scale combat are the two expensive asks.** Recorded voice
   for three personalities and furniture-aware movement are each bigger than
   everything else in the MVP. Fix: text barks plus crowd audio first; the
   table stays the ring.

Smaller risks: draws stall matches; a 6 s choose window invites waiting for
the last moment; hands give no haptics, so every confirmation needs sound and
motion; progression needs accounts before it can be trusted in ranked play.

## 3. Selection flow (the UX problem)

One round, about 12 seconds:

| Step | Player sees and hears | Rule |
|---|---|---|
| 1. Call | "3, 2, 1, THROW!" over the ring; crowd rises | 2.5 s |
| 2. Read | A fighter card appears above your corner as soon as a pose is read: silhouette, **ROCK**, "Heavyweight", fighter colour. Change your pose and the card swaps. | Under 150 ms. Only you see the face; your rival sees "choosing" |
| 3. Lock | A ring fills around the card while you hold steady (0.6 s). Pinching with your other hand locks at once. | Lock is final |
| 4. Acknowledge | Card stamps **LOCKED**, flips face down into your corner. Fighter bark: "Rock. Let's go." | Rival sees a face-down card |
| 5. Reveal | Both cards flip together. Fighters walk out (1.2 s). Banner: "ROCK crushes SCISSORS" | Starts when both lock or time runs out |
| 6. Hit | Winner's signature move; health drops on impact | 3 s |

Rules that keep it clear:

- One colour and one silhouette per fighter, used on cards, HUD and effects.
- No pose by the deadline: "No show", small penalty (already built).
- The card is the single source of truth for "what did it read". Never show a
  fighter before the lock.

## 4. Making the fight matter (Version 2, needs playtesting)

The throw still decides who attacks. Each fighter adds one rule:

| Fighter | Win | Identity rule |
|---|---|---|
| Rock, heavyweight | 30 damage | **Stun:** the loser's next choose window is 1 s shorter |
| Paper, tactician | 20 damage | **Counter:** +10 if the rival repeated their last throw. **Guard:** takes 5 less when losing |
| Scissors, speed | 20 damage | **Combo:** consecutive Scissors wins deal 20, 25, 30 |

Draws add +5 "crowd hype" to the next hit, so they build tension instead of
stalling. These rules reward reading the opponent, which is the real skill of
the game. All values are the same for every player at every level.

## 5. Fighters

| | Rock | Paper | Scissors |
|---|---|---|---|
| Body | Huge gloved fist, wrapped knuckles, thick forearm | Open hand, wrist tape, captain's armband | Two-finger runner, light frame, always bouncing |
| Moves | Heavy Punch, Ground Slam, Stun Knockout | Palm Push, Counter Strike, Deflection Guard | Dash Strike, Combo Rush, Dodge Step |
| Barks | "Biggest hand in the building!" | "Read you. Again." | "Blink and you missed it!" |

Barks ship as on-screen text with a crowd reaction first. Recorded voice comes
in Version 2 (about 15 lines per fighter).

## 6. Progression

Sessions are 3 to 10 minutes: a match is 1 to 2 minutes, so a session is 2 to
5 matches.

### Player rank (stars)

Win +1 star, loss âˆ’1, win streak of 3 or more +1 extra. No star loss below
Contender.

| Rank | Stars | Unlocks |
|---|---|---|
| Rookie | 0 | Three fighters, practice, friend rooms |
| Amateur | 5 | Daily challenges, wrist wrap slot |
| Contender | 15 | Ranked queue, entrance animations |
| Challenger | 30 | Arena themes, victory poses |
| Champion | 50 | Championship belt, champion title |
| Hall of Fame | 80, held to season end | Permanent season badge, name on the board |

### Fighter levels (each fighter separately)

XP: 10 per round played, 25 per round won, 50 for the match-winning hit.
Level 5 takes about 30 minutes with that fighter, Level 20 about 8 hours.

| Level | Rock | Paper | Scissors |
|---|---|---|---|
| 1 | Heavy Punch | Palm Push | Dash Strike |
| 5 | Ground Slam finisher | Deflection Guard animation | Dodge Step taunt |
| 10 | Knockout Combo finisher | Counter Strike finisher | Combo Rush finisher |
| 15 | Champion Entrance | Captain's Entrance | Showman Entrance |
| 20 | Legendary skin | Legendary skin | Legendary skin |

Every unlock is a look or an animation. Damage never changes.

### Gesture mastery

Counts locked throws per fighter: 50, 250, 500 (Master badge), 1,000, 2,500.
A second track counts wins with that fighter, so skill and volume are both
recognised.

### Streaks

| Match wins in a row | Title | Reward while it lasts |
|---|---|---|
| 3 | Hot Hand | Your real hands glow |
| 5 | On Fire | Flame trail on your fighter, crowd chant |
| 10 | Unstoppable | Announcer call, special entrance |
| 20 | Legendary | Permanent badge |

Single-match awards: Perfect (no damage taken), Comeback (win from 20 HP or
less), Mind Reader (three round wins in a row), Upset (beat a higher rank).

### Challenges

- **Daily (3):** small and varied. "Win 3 rounds with Paper", "Play 2
  matches", "Land a finisher".
- **Weekly (3):** "Win 10 matches", "Reach a 5 streak", "Play a friend".
- **Season (6 to 8 weeks):** a 30-step free track with a theme and one
  headline skin. No paid track and no expiring purchases.

## 7. Cosmetics and collection

Slots: fighter skin, gloves, wrist wraps, belt, entrance, victory pose, title,
profile badge, arena theme. Existing stone, paper and steel sculptures become
the first alternate skins.

The **Locker Room** shows every item, including locked ones with the exact
unlock condition. Unlocks are deterministic: no loot boxes and no duplicates.
Finishing a set (for example all Rock items from a season) grants a title.

## 8. Mixed reality

- **MVP:** the table is the ring; panels and cards float in the room; your
  real hands glow on streaks.
- **Version 3:** fighters walk out life-size across the floor, then shrink
  onto the table ring; the floor ring option uses the detected floor plane.
- **Later:** furniture as scenery (a fighter leaps off the sofa edge).
  Furniture as *gameplay* is out of scope: rooms differ too much to be fair.

## 9. Live features, in build order

1. Friend rooms and matchmaking (built).
2. Accounts and server-side profiles (required before ranked).
3. Ranked queue by star rank.
4. Spectator seat: a read-only third connection to a room.
5. Weekend tournaments: 8-player brackets run by the room server.
6. Seasonal events: a rule twist plus a themed skin.

## 10. Roadmap

| Version | Goal | Contents |
|---|---|---|
| **MVP** | Clear and exciting single match | Selection cards and lock flow; remove magic effects; fighter re-skin and names; text barks and crowd audio; draw hype; streaks and match awards; profile saved on the device (stars, fighter XP, mastery); 3 daily challenges; shareable victory moment |
| **Version 2** | Reasons to return | Fighter identity rules (after playtests); Locker Room and cosmetics; accounts; ranked queue; weekly challenges; recorded voice |
| **Version 3** | Spectacle and community | Floor-scale entrances; spectator seat; seasons; arena themes |
| **Version 4** | Live game | Tournaments; seasonal events; leaderboards; Hall of Fame board |

## 11. Decisions (agreed)

1. Fighter look: dress the existing hand sculptures with gloves, tape and belts.
2. The section 4 identity rules are wanted (Version 2, after playtests).
3. A device-only profile is acceptable for the MVP.
4. Character expansion is out of scope.
